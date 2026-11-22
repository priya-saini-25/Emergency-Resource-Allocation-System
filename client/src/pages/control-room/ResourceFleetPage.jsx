import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import EmptyState, { ErrorState } from '../../components/ui/EmptyState.jsx';
import resourceService from '../../services/resourceService.js';
import { getStationDisplayName } from '../../components/map/mapIcons.js';
import {
  Truck,
  RotateCw,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  Radio,
  AlertTriangle,
  MapPin,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Shield,
  Layers,
} from 'lucide-react';

const STATUS_FILTERS = [
  { value: '', label: 'All Fleet Units' },
  { value: 'AVAILABLE', label: 'Available' },
  { value: 'RESERVED', label: 'Reserved' },
  { value: 'DISPATCHED', label: 'Dispatched' },
  { value: 'OUT_OF_SERVICE', label: 'Out of Service' },
];

const TYPE_OPTIONS = [
  { value: '', label: 'All Vehicle Classes' },
  { value: 'ALS_AMBULANCE', label: 'Advanced Life Support (ALS) Ambulance' },
  { value: 'BLS_AMBULANCE', label: 'Basic Life Support (BLS) Ambulance' },
  { value: 'FIRE_ENGINE', label: 'Fire Engine (Pumper)' },
  { value: 'FIRE_TENDER', label: 'Fire Water Tender' },
  { value: 'RESCUE_VEHICLE', label: 'Heavy Rescue Vehicle' },
];

export function ResourceFleetPage() {
  const [resources, setResources] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [stats, setStats] = useState({
    totalResources: 0,
    availableCount: 0,
    reservedCount: 0,
    dispatchedCount: 0,
    outOfServiceCount: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);

  // Detail Modal
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedResource, setSelectedResource] = useState(null);

  const fetchResources = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = {
        page,
        limit: 20,
        sortBy: 'resourceId',
        sortOrder: 'asc',
      };
      if (statusFilter) params.status = statusFilter;
      if (typeFilter) params.resourceType = typeFilter;
      if (searchInput.trim()) params.search = searchInput.trim();

      const [resData, statsData] = await Promise.all([
        resourceService.listResources(params),
        resourceService.getResourceStats(),
      ]);

      setResources(resData.resources || []);
      setPagination(resData.pagination || null);
      if (statsData) {
        setStats({
          totalResources: statsData.totalResources || 0,
          availableCount: statsData.availableCount || 0,
          reservedCount: statsData.reservedCount || 0,
          dispatchedCount: statsData.dispatchedCount || 0,
          outOfServiceCount: statsData.outOfServiceCount || 0,
        });
      }
      setIsLoading(false);
    } catch (err) {
      setError(err);
      setIsLoading(false);
    }
  }, [page, statusFilter, typeFilter, searchInput]);

  useEffect(() => {
    fetchResources();
  }, [fetchResources]);

  const handleOpenDetail = (res) => {
    setSelectedResource(res);
    setDetailModalOpen(true);
  };

  const columns = [
    {
      key: 'resourceId',
      header: 'Unit Identifier',
      render: (val, row) => (
        <div>
          <span className="font-mono font-bold text-theme-heading block">#{val}</span>
          <span className="text-[11px] text-gray-500 font-medium">{row.name}</span>
        </div>
      ),
    },
    {
      key: 'resourceType',
      header: 'Vehicle Class',
      render: (val) => (
        <span className="font-semibold text-xs text-theme-heading uppercase tracking-wide">
          {val?.replace(/_/g, ' ')}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (val) => {
        let variant = 'primary';
        if (val === 'AVAILABLE') variant = 'success';
        if (val === 'RESERVED') variant = 'warning';
        if (val === 'DISPATCHED') variant = 'primary';
        if (val === 'OUT_OF_SERVICE') variant = 'neutral';
        return <Badge variant={variant} size="sm">{val}</Badge>;
      },
    },
    {
      key: 'stationId',
      header: 'Base Station / Depot',
      render: (val, row) => (
        <span className="text-gray-700 text-xs font-medium">
          {getStationDisplayName(val, row?.name)}
        </span>
      ),
    },
    {
      key: 'assignedIncidentId',
      header: 'Active Assignment',
      render: (val) =>
        val ? (
          <Link
            to={`/control-room/incidents/${val}`}
            className="font-mono font-bold text-theme-primary hover:underline text-xs"
          >
            Incident #{val}
          </Link>
        ) : (
          <span className="text-gray-400 text-xs italic">Unassigned</span>
        ),
    },
    {
      key: 'location',
      header: 'Base Coordinates',
      render: (val) => (
        <span className="font-mono text-gray-500 text-[11px]">
          {val ? `${val.latitude.toFixed(4)}, ${val.longitude.toFixed(4)}` : 'N/A'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Detail',
      render: (_, row) => (
        <Button variant="outline" size="sm" onClick={() => handleOpenDetail(row)}>
          Inspect
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Emergency Fleet & Resource Management"
        subtitle="Ambulances, fire engines, tenders, and heavy rescue units across Jodhpur Urban Service Area"
        badge={<Badge variant="primary">Authoritative Fleet</Badge>}
        actions={
          <Button variant="secondary" size="sm" icon={RotateCw} onClick={fetchResources} disabled={isLoading}>
            Refresh
          </Button>
        }
      />

      {/* Simulation Banner */}
      <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3.5 flex items-center justify-between text-xs text-amber-900">
        <div className="flex items-center space-x-2.5">
          <Shield className="w-4 h-4 text-amber-700 flex-shrink-0" />
          <span>
            <strong>DEMO SIMULATION — NOT CONNECTED TO LIVE EMERGENCY SERVICES.</strong> Resource assignments are controlled by backend transaction services. Stored coordinates denote stationary depots, not real-time GPS telemetry.
          </span>
        </div>
        <Badge variant="warning" size="sm">Academic Simulation</Badge>
      </div>

      {/* Fleet Summary Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="Total Fleet Units"
          value={stats.totalResources.toString()}
          subtitle="Registered vehicles in Jodhpur"
          icon={Truck}
          indicatorColor="#5685B5"
        />
        <StatCard
          title="Available for Dispatch"
          value={stats.availableCount.toString()}
          subtitle="Ready for decision engine snapping"
          icon={CheckCircle2}
          indicatorColor="#56866B"
        />
        <StatCard
          title="Currently Mobilized"
          value={stats.dispatchedCount.toString()}
          subtitle="Dispatched or on-scene"
          icon={Radio}
          indicatorColor="#E89543"
        />
        <StatCard
          title="Reserved in Batch"
          value={stats.reservedCount.toString()}
          subtitle="Locked by pending dispatch"
          icon={Clock}
          indicatorColor="#789CB8"
        />
      </div>

      {/* Filter Bar */}
      <div className="p-4 bg-white border border-theme-border rounded-xl shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Status Tabs */}
          <div className="flex flex-wrap items-center gap-1">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => {
                  setStatusFilter(f.value);
                  setPage(1);
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  statusFilter === f.value
                    ? 'bg-theme-sidebar text-white shadow-xs'
                    : 'text-gray-600 hover:text-theme-heading hover:bg-theme-bg'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Type Selector */}
          <div className="w-64">
            <Select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setPage(1);
              }}
              options={TYPE_OPTIONS}
              className="text-xs"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      {error ? (
        <ErrorState
          icon={AlertTriangle}
          title="Failed to Load Fleet Registry"
          message={error.message}
          onRetry={fetchResources}
        />
      ) : (
        <Card className="p-0 overflow-hidden border border-theme-border shadow-xs">
          <DataTable
            columns={columns}
            data={resources}
            keyField="resourceId"
            loading={isLoading}
            emptyMessage="No emergency fleet units match the selected criteria."
          />

          {/* Pagination */}
          {!isLoading && pagination && pagination.totalPages > 1 && (
            <div className="px-4 py-3 bg-white border-t border-theme-border flex items-center justify-between text-xs text-gray-600">
              <span>
                Page {pagination.page} of {pagination.totalPages} ({pagination.totalCount} units)
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

      {/* RESOURCE DETAIL MODAL */}
      <Modal
        isOpen={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        title={`Unit Details: #${selectedResource?.resourceId} (${selectedResource?.name})`}
        subtitle="Operational telemetry and allocation tracking"
      >
        {selectedResource && (
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 grid grid-cols-2 gap-3">
              <div>
                <span className="text-gray-500 block">Class:</span>
                <strong className="text-theme-heading text-sm">
                  {selectedResource.resourceType?.replace(/_/g, ' ')}
                </strong>
              </div>
              <div>
                <span className="text-gray-500 block">Status:</span>
                <Badge
                  variant={selectedResource.status === 'AVAILABLE' ? 'success' : 'primary'}
                  size="md"
                >
                  {selectedResource.status}
                </Badge>
              </div>
              <div>
                <span className="text-gray-500 block">Base Depot / Station:</span>
                <strong className="text-gray-700">
                  {getStationDisplayName(selectedResource.stationId, selectedResource.name)}
                </strong>
                <span className="text-[10px] text-gray-400 block mt-0.5 italic">
                  Stationary simulated base depot · Live GPS tracking not connected
                </span>
              </div>
              <div>
                <span className="text-gray-500 block">Personnel Capacity:</span>
                <strong className="text-gray-700">{selectedResource.capacity || 1} responders</strong>
              </div>
            </div>

            <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-lg space-y-1">
              <span className="font-semibold text-blue-900 block flex items-center space-x-1">
                <MapPin className="w-3.5 h-3.5 text-theme-primary" />
                <span>Stationary Depot Location:</span>
              </span>
              <p className="font-mono text-gray-600 text-[11px]">
                Latitude: {selectedResource.location?.latitude.toFixed(6)}° N, Longitude: {selectedResource.location?.longitude.toFixed(6)}° E
              </p>
              <p className="text-[10px] text-gray-500">
                Nearest OSM Road Node: <code>{selectedResource.currentNodeOsmId || 'Auto-snapped'}</code>
              </p>
            </div>

            {selectedResource.assignedIncidentId && (
              <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg space-y-1">
                <span className="font-semibold text-amber-900 block flex items-center space-x-1">
                  <Radio className="w-3.5 h-3.5 text-amber-700" />
                  <span>Currently Mobilized on Emergency:</span>
                </span>
                <p className="text-[11px] text-gray-700">
                  Assigned to <Link to={`/control-room/incidents/${selectedResource.assignedIncidentId}`} className="font-mono font-bold text-theme-primary hover:underline">Incident #{selectedResource.assignedIncidentId}</Link>
                </p>
                {selectedResource.dispatchedAt && (
                  <p className="text-[10px] text-gray-500">
                    Mobilization Timestamp: {new Date(selectedResource.dispatchedAt).toLocaleString()}
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-theme-border">
              <Button variant="outline" size="sm" onClick={() => setDetailModalOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default ResourceFleetPage;
