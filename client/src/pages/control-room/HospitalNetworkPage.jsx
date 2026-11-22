import React, { useState, useEffect, useCallback } from 'react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import EmptyState, { ErrorState } from '../../components/ui/EmptyState.jsx';
import hospitalService from '../../services/hospitalService.js';
import {
  Building2,
  RotateCw,
  HeartPulse,
  Activity,
  Bed,
  Shield,
  AlertTriangle,
  MapPin,
  CheckCircle2,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

export function HospitalNetworkPage() {
  const [hospitals, setHospitals] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [stats, setStats] = useState({
    totalHospitals: 0,
    operationalHospitals: 0,
    totalBeds: 0,
    availableBeds: 0,
    occupiedBeds: 0,
    occupancyRate: 0,
    bedsByCategory: {
      icu: { total: 0, available: 0, occupied: 0 },
      general: { total: 0, available: 0, occupied: 0 },
      oxygen: { total: 0, available: 0, occupied: 0 },
    },
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Detail Modal
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedHospital, setSelectedHospital] = useState(null);

  const fetchHospitals = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = { page, limit: 15 };
      if (search.trim()) params.search = search.trim();

      const [hospData, statsData] = await Promise.all([
        hospitalService.listHospitals(params),
        hospitalService.getHospitalStats(),
      ]);

      setHospitals(hospData.hospitals || []);
      setPagination(hospData.pagination || null);
      if (statsData) {
        setStats({
          totalHospitals: statsData.totalHospitals || 0,
          operationalHospitals: statsData.operationalHospitals || 0,
          totalBeds: statsData.totalBeds || 0,
          availableBeds: statsData.availableBeds || 0,
          occupiedBeds: statsData.occupiedBeds || 0,
          occupancyRate: statsData.occupancyRate || 0,
          bedsByCategory: statsData.bedsByCategory || {
            icu: { total: 0, available: 0, occupied: 0 },
            general: { total: 0, available: 0, occupied: 0 },
            oxygen: { total: 0, available: 0, occupied: 0 },
          },
        });
      }
      setIsLoading(false);
    } catch (err) {
      setError(err);
      setIsLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchHospitals();
  }, [fetchHospitals]);

  const handleOpenDetail = (hosp) => {
    setSelectedHospital(hosp);
    setDetailModalOpen(true);
  };

  const columns = [
    {
      key: 'name',
      header: 'Hospital Facility',
      render: (val, row) => (
        <div>
          <span className="font-bold text-theme-heading text-xs block">{val}</span>
          <span className="text-[11px] text-gray-400 font-mono">ID: #{row.hospitalId}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Operational Status',
      render: (val) => (
        <Badge variant={val === 'OPERATIONAL' ? 'success' : 'neutral'} size="sm">
          {val}
        </Badge>
      ),
    },
    {
      key: 'availableBeds',
      header: 'Simulated Bed Availability',
      render: (val, row) => {
        const total = row.totalBeds || 1;
        const pct = Math.round((val / total) * 100);
        return (
          <div className="w-36 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="font-semibold text-emerald-700">{val} / {row.totalBeds} beds</span>
              <span className="text-gray-400">{pct}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-emerald-500 h-1.5 rounded-full"
                style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
              />
            </div>
          </div>
        );
      },
    },
    {
      key: 'icuBeds',
      header: 'ICU Capacity',
      render: (val) => (
        <span className="text-xs font-medium text-gray-700">
          {val?.available || 0} / {val?.total || 0} beds
        </span>
      ),
    },
    {
      key: 'capabilities',
      header: 'Key Capabilities',
      render: (caps) => (
        <div className="flex flex-wrap gap-1 max-w-[200px]">
          {Array.isArray(caps) && caps.length > 0 ? (
            caps.slice(0, 2).map((c, idx) => (
              <Badge key={idx} variant="secondary" size="sm">
                {c.replace(/_/g, ' ')}
              </Badge>
            ))
          ) : (
            <span className="text-gray-400 text-xs">General Care</span>
          )}
          {caps?.length > 2 && (
            <span className="text-[10px] text-gray-400">+{caps.length - 2}</span>
          )}
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Coordinates',
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
        title="Emergency Hospital Network & Bed Capacity"
        subtitle="Simulated bed reservations, trauma capabilities, and hospital matching in Jodhpur Urban Service Area"
        badge={<Badge variant="primary">Trauma Network</Badge>}
        actions={
          <Button variant="secondary" size="sm" icon={RotateCw} onClick={fetchHospitals} disabled={isLoading}>
            Refresh
          </Button>
        }
      />

      {/* Simulation Notice Banner */}
      <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3.5 flex items-center justify-between text-xs text-amber-900">
        <div className="flex items-center space-x-2.5">
          <Shield className="w-4 h-4 text-amber-700 flex-shrink-0" />
          <span>
            <strong>DEMO SIMULATION — NOT CONNECTED TO LIVE EMERGENCY SERVICES.</strong> Hospital bed capacities and ICU reservations are simulated academic records for Dijkstra hospital-matching evaluation, not actual real-world clinical availability.
          </span>
        </div>
        <Badge variant="warning" size="sm">Academic Simulation</Badge>
      </div>

      {/* Capacity Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="Network Bed Capacity"
          value={stats.totalBeds.toString()}
          subtitle={`${stats.operationalHospitals} operational hospitals`}
          icon={Building2}
          indicatorColor="#0D9488"
        />
        <StatCard
          title="Available Beds"
          value={stats.availableBeds.toString()}
          subtitle={`${stats.occupancyRate}% simulated occupancy`}
          icon={Bed}
          indicatorColor="#56866B"
        />
        <StatCard
          title="Available ICU Beds"
          value={`${stats.bedsByCategory?.icu?.available || 0} / ${stats.bedsByCategory?.icu?.total || 0}`}
          subtitle="Critical trauma patient triage"
          icon={HeartPulse}
          indicatorColor="#DC4545"
        />
        <StatCard
          title="Available Oxygen Beds"
          value={`${stats.bedsByCategory?.oxygen?.available || 0} / ${stats.bedsByCategory?.oxygen?.total || 0}`}
          subtitle="Severe respiratory support"
          icon={Activity}
          indicatorColor="#5685B5"
        />
      </div>

      {/* Table */}
      {error ? (
        <ErrorState
          icon={AlertTriangle}
          title="Failed to Load Hospital Registry"
          message={error.message}
          onRetry={fetchHospitals}
        />
      ) : (
        <Card className="p-0 overflow-hidden border border-theme-border shadow-xs">
          <DataTable
            columns={columns}
            data={hospitals}
            keyField="hospitalId"
            loading={isLoading}
            emptyMessage="No hospitals found in the registry."
          />

          {/* Pagination */}
          {!isLoading && pagination && pagination.totalPages > 1 && (
            <div className="px-4 py-3 bg-white border-t border-theme-border flex items-center justify-between text-xs text-gray-600">
              <span>
                Page {pagination.page} of {pagination.totalPages} ({pagination.totalCount} facilities)
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

      {/* HOSPITAL DETAIL MODAL */}
      <Modal
        isOpen={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        title={`Facility Details: ${selectedHospital?.name}`}
        subtitle={`Hospital ID: #${selectedHospital?.hospitalId} · Jodhpur Urban Area`}
      >
        {selectedHospital && (
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 grid grid-cols-2 gap-3">
              <div>
                <span className="text-gray-500 block">Status:</span>
                <Badge variant={selectedHospital.status === 'OPERATIONAL' ? 'success' : 'neutral'} size="md">
                  {selectedHospital.status}
                </Badge>
              </div>
              <div>
                <span className="text-gray-500 block">Total Capacity:</span>
                <strong className="text-theme-heading text-sm">{selectedHospital.totalBeds} total beds</strong>
              </div>
            </div>

            {/* Bed Category Breakdown */}
            <div className="p-3 bg-white rounded-lg border border-gray-200 space-y-2">
              <span className="font-semibold text-theme-heading block">Simulated Bed Category Allocation:</span>
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 bg-emerald-50/70 border border-emerald-200 rounded text-center">
                  <span className="text-[10px] text-emerald-800 font-semibold block">General Beds</span>
                  <span className="text-sm font-bold text-emerald-900">
                    {selectedHospital.generalBeds?.available} / {selectedHospital.generalBeds?.total}
                  </span>
                </div>
                <div className="p-2 bg-red-50/70 border border-red-200 rounded text-center">
                  <span className="text-[10px] text-red-800 font-semibold block">ICU Beds</span>
                  <span className="text-sm font-bold text-red-900">
                    {selectedHospital.icuBeds?.available} / {selectedHospital.icuBeds?.total}
                  </span>
                </div>
                <div className="p-2 bg-blue-50/70 border border-blue-200 rounded text-center">
                  <span className="text-[10px] text-blue-800 font-semibold block">Oxygen Beds</span>
                  <span className="text-sm font-bold text-blue-900">
                    {selectedHospital.oxygenBeds?.available} / {selectedHospital.oxygenBeds?.total}
                  </span>
                </div>
              </div>
            </div>

            {/* Capabilities */}
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-1.5">
              <span className="font-semibold text-gray-700 block">Trauma & Medical Capabilities:</span>
              <div className="flex flex-wrap gap-1">
                {selectedHospital.capabilities?.map((cap, idx) => (
                  <Badge key={idx} variant="primary" size="sm">
                    {cap.replace(/_/g, ' ')}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Geographic Coordinates */}
            <div className="p-3 bg-teal-50/70 border border-teal-200 rounded-lg space-y-1">
              <span className="font-semibold text-teal-900 block flex items-center space-x-1">
                <MapPin className="w-3.5 h-3.5 text-teal-700" />
                <span>Geographic Location:</span>
              </span>
              <p className="font-mono text-gray-600 text-[11px]">
                {selectedHospital.location?.latitude.toFixed(6)}° N, {selectedHospital.location?.longitude.toFixed(6)}° E
              </p>
              <p className="text-[10px] text-gray-500">
                Nearest OSM Road Graph Node: <code>{selectedHospital.osmNodeId || 'Auto-snapped'}</code>
              </p>
            </div>

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

export default HospitalNetworkPage;
