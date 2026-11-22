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
import MapContainer from '../../components/map/MapContainer.jsx';
import { Polyline, Marker, Popup } from 'react-leaflet';
import decodePolyline from '../../utils/polylineDecoder.js';
import { incidentIcon, resourceIcon, hospitalIcon } from '../../components/map/mapIcons.js';
import incidentService from '../../services/incidentService.js';
import dispatchService from '../../services/dispatchService.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import {
  Send,
  Cpu,
  CheckCheck,
  Truck,
  Building2,
  AlertTriangle,
  RotateCw,
  History,
  Shield,
  Layers,
  Clock,
  MapPin,
  CheckCircle2,
  XCircle,
  ExternalLink,
  ChevronRight,
  Flame,
  Info,
  SlidersHorizontal,
} from 'lucide-react';

export function DispatchPlannerPage() {
  const { success, info, error: toastError } = useNotification();
  const [activeTab, setActiveTab] = useState('PLANNER'); // 'PLANNER' or 'HISTORY'

  // Verified Incidents Selection State
  const [verifiedIncidents, setVerifiedIncidents] = useState([]);
  const [selectedIncidentIds, setSelectedIncidentIds] = useState([]);
  const [isLoadingIncidents, setIsLoadingIncidents] = useState(true);
  const [incidentFetchError, setIncidentFetchError] = useState(null);

  // Recommendation Run State
  const [currentRecommendation, setCurrentRecommendation] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState(null);

  // Historical Recommendations
  const [historicalBatches, setHistoricalBatches] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState(null);

  // Confirmation Modal State
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [allowPartialDispatch, setAllowPartialDispatch] = useState(true);
  const [confirmationNotes, setConfirmationNotes] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState(null);
  const [confirmSuccess, setConfirmSuccess] = useState(null);

  // Map route visualizer state
  const [showMap, setShowMap] = useState(false);

  // 1. Fetch Verified Incidents eligible for allocation
  const fetchVerifiedIncidents = useCallback(async () => {
    setIsLoadingIncidents(true);
    setIncidentFetchError(null);
    try {
      const res = await incidentService.listIncidents({ status: 'VERIFIED', limit: 25 });
      const items = res.incidents || [];
      setVerifiedIncidents(items);
      // Auto-select first few by default for convenience if none selected
      if (items.length > 0 && selectedIncidentIds.length === 0) {
        setSelectedIncidentIds(items.slice(0, Math.min(items.length, 3)).map((i) => i.incidentId));
      }
      setIsLoadingIncidents(false);
    } catch (err) {
      setIncidentFetchError(err);
      setIsLoadingIncidents(false);
    }
  }, [selectedIncidentIds.length]);

  // 2. Fetch History of Dispatch Batches
  const fetchHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    setHistoryError(null);
    try {
      const res = await dispatchService.listRecommendations({ limit: 15 });
      setHistoricalBatches(res.recommendations || res || []);
      setIsLoadingHistory(false);
    } catch (err) {
      setHistoryError(err);
      setIsLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    fetchVerifiedIncidents();
  }, [fetchVerifiedIncidents]);

  useEffect(() => {
    if (activeTab === 'HISTORY') {
      fetchHistory();
    }
  }, [activeTab, fetchHistory]);

  const toggleIncidentSelection = (id) => {
    setSelectedIncidentIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id);
      } else {
        if (prev.length >= 25) return prev; // max 25
        return [...prev, id];
      }
    });
  };

  const handleSelectAll = () => {
    const ids = verifiedIncidents.slice(0, 25).map((i) => i.incidentId);
    setSelectedIncidentIds(ids);
  };

  const handleDeselectAll = () => {
    setSelectedIncidentIds([]);
  };

  // Execute C++ Recommendation Engine
  const handleGenerateRecommendations = async () => {
    if (selectedIncidentIds.length === 0) return;
    setIsGenerating(true);
    setGenerationError(null);
    setConfirmSuccess(null);
    try {
      const rec = await dispatchService.generateRecommendations(selectedIncidentIds);
      setCurrentRecommendation(rec);
      setIsGenerating(false);
      info('Resource allocation recommendation generated.');
      success('Resources allocated successfully.');
      // Scroll to recommendations
      window.scrollTo({ top: 380, behavior: 'smooth' });
    } catch (err) {
      setGenerationError(err);
      setIsGenerating(false);
      toastError(err.message || 'Resource allocation recommendation failed.');
    }
  };

  // Inspect specific historical recommendation
  const handleViewHistorical = async (batchId) => {
    try {
      const rec = await dispatchService.getRecommendation(batchId);
      setCurrentRecommendation(rec);
      setActiveTab('PLANNER');
      window.scrollTo({ top: 380, behavior: 'smooth' });
    } catch (err) {
      setGenerationError(err);
    }
  };

  // Calculate vehicle and allocation failure metrics
  const totalAllocatedVehicles = (currentRecommendation?.incidentResults || []).reduce(
    (sum, inc) => sum + (inc.assignedResources?.length || 0),
    0
  );

  const isBatchFailed = Boolean(
    currentRecommendation &&
      (currentRecommendation.batchStatus === 'FAILED' ||
        currentRecommendation.recommendationStatus === 'FAILED' ||
        totalAllocatedVehicles === 0)
  );

  // Open Confirmation Modal
  const handleOpenConfirm = () => {
    if (isBatchFailed) return;
    setConfirmError(null);
    setConfirmationNotes('');
    setConfirmModalOpen(true);
  };

  // Execute Atomic Dispatch Confirmation
  const handleConfirmDispatch = async () => {
    if (!currentRecommendation || isBatchFailed) return;
    setIsConfirming(true);
    setConfirmError(null);

    const idempotencyKey = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `idem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    try {
      const result = await dispatchService.confirmDispatch(
        currentRecommendation.batchId,
        {
          allowPartialDispatch,
          confirmationNotes: confirmationNotes.trim(),
          idempotencyKey,
        },
        idempotencyKey
      );

      setConfirmSuccess({
        batchId: currentRecommendation.batchId,
        dispatchId: result.dispatchId || currentRecommendation.batchId,
        message: result.isIdempotentReplay
          ? 'Idempotent replay: Dispatch was already confirmed.'
          : 'Fleet dispatched and hospital beds reserved successfully!',
      });

      // Update current recommendation status in UI
      setCurrentRecommendation((prev) => ({
        ...prev,
        confirmationStatus: 'CONFIRMED',
        dispatchId: result.dispatchId,
      }));

      setConfirmModalOpen(false);
      setIsConfirming(false);
      success('Dispatch confirmed successfully.');

      const hasHospital = (result?.hospitalReservations && result.hospitalReservations.length > 0) ||
        (currentRecommendation?.hospitalReservations && currentRecommendation.hospitalReservations.length > 0) ||
        (currentRecommendation?.incidentResults && currentRecommendation.incidentResults.some(inc => inc.assignedHospitalId || inc.assignedHospital));
      if (hasHospital) {
        info('Hospital assigned successfully.');
      }

      // Refresh verified incidents list
      fetchVerifiedIncidents();
    } catch (err) {
      setConfirmError(err.message || 'Dispatch confirmation failed.');
      toastError(err.message || 'Dispatch confirmation failed.');
      setIsConfirming(false);
    }
  };

  // Extract all decoded routes for map overlay
  const mapPolylines = [];
  if (currentRecommendation && currentRecommendation.incidentResults) {
    currentRecommendation.incidentResults.forEach((inc) => {
      // Resource to Incident Routes
      if (Array.isArray(inc.assignedResources)) {
        inc.assignedResources.forEach((r) => {
          if (r.routePolyline) {
            const coords = decodePolyline(r.routePolyline);
            if (coords.length > 0) {
              mapPolylines.push({
                key: `res_${r.resourceId}_inc_${inc.incidentId}`,
                color: '#5685B5', // Blue for units
                coords,
                title: `Unit ${r.resourceType} #${r.resourceId} → Incident #${inc.incidentId} (${(r.distanceMeters / 1000).toFixed(1)} km, ~${Math.round(r.estimatedArrivalSeconds / 60)} min)`,
              });
            }
          }
        });
      }

      // Incident to Hospital Routes
      if (inc.recommendedHospital && inc.recommendedHospital.routePolyline) {
        const coords = decodePolyline(inc.recommendedHospital.routePolyline);
        if (coords.length > 0) {
          mapPolylines.push({
            key: `inc_${inc.incidentId}_hosp_${inc.recommendedHospital.hospitalId}`,
            color: '#0D9488', // Teal for hospital
            coords,
            title: `Incident #${inc.incidentId} → ${inc.recommendedHospital.hospitalName} (${(inc.recommendedHospital.distanceMeters / 1000).toFixed(1)} km, ~${Math.round(inc.recommendedHospital.estimatedTransportSeconds / 60)} min)`,
          });
        }
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Dispatch Recommendation Planner"
        subtitle="C++17 Decision Engine Integration · Optimal Fleet Allocation & Hospital Bed Reservation · Jodhpur"
        badge={<Badge variant="primary">Decision Engine v1.0</Badge>}
        actions={
          <div className="flex items-center space-x-2">
            <Button
              variant={activeTab === 'PLANNER' ? 'primary' : 'outline'}
              size="sm"
              icon={Send}
              onClick={() => setActiveTab('PLANNER')}
            >
              Dispatch Planner
            </Button>
            <Button
              variant={activeTab === 'HISTORY' ? 'primary' : 'outline'}
              size="sm"
              icon={History}
              onClick={() => setActiveTab('HISTORY')}
            >
              Batch History
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={RotateCw}
              onClick={() => {
                fetchVerifiedIncidents();
                if (activeTab === 'HISTORY') fetchHistory();
              }}
            >
              Refresh
            </Button>
          </div>
        }
      />

      {/* Academic Simulation Banner */}
      <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3.5 flex items-center justify-between text-xs text-amber-900">
        <div className="flex items-center space-x-2.5">
          <Shield className="w-4 h-4 text-amber-700 flex-shrink-0" />
          <span>
            <strong>DEMO SIMULATION — NOT CONNECTED TO LIVE EMERGENCY SERVICES.</strong> Allocations use a priority-first greedy C++17 algorithm over OSM Jodhpur road graph (59,334 nodes, 129,778 edges). Not clinically validated triage.
          </span>
        </div>
        <Badge variant="warning" size="sm">
          Academic Simulation
        </Badge>
      </div>

      {/* Success Notification Banner */}
      {confirmSuccess && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center justify-between animate-in fade-in">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <div>
              <p className="font-semibold">{confirmSuccess.message}</p>
              <p className="text-[11px] text-emerald-700">
                Batch ID: <code>{confirmSuccess.batchId}</code> · Dispatch ID: <code>{confirmSuccess.dispatchId}</code>
              </p>
            </div>
          </div>
          <Link to="/control-room/active-incidents">
            <Button variant="primary" size="sm" icon={ExternalLink}>
              View Active Operations
            </Button>
          </Link>
        </div>
      )}

      {/* Generation Error Banner */}
      {generationError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-900 flex items-start space-x-2">
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <strong className="block font-semibold">Optimization Run Failed:</strong>
            <span>{generationError.message || 'Failed to generate recommendations from C++ engine.'}</span>
          </div>
        </div>
      )}

      {activeTab === 'PLANNER' ? (
        <div className="space-y-6">
          {/* Top Section: Incident Selection Grid */}
          <Card>
            <Card.Header
              title="Step 1: Select Verified Incidents for Batch Allocation"
              subtitle={`Select up to 25 verified incidents currently awaiting dispatch recommendation (${selectedIncidentIds.length} selected)`}
              action={
                <div className="flex items-center space-x-2">
                  <Button variant="ghost" size="sm" onClick={handleSelectAll}>
                    Select All ({verifiedIncidents.length})
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleDeselectAll}>
                    Clear
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    icon={Cpu}
                    onClick={handleGenerateRecommendations}
                    loading={isGenerating}
                    disabled={selectedIncidentIds.length === 0 || isGenerating}
                  >
                    Run C++ Optimization ({selectedIncidentIds.length})
                  </Button>
                </div>
              }
            />

            {isLoadingIncidents ? (
              <div className="p-6 space-y-3">
                <Skeleton count={3} variant="tableRow" />
              </div>
            ) : incidentFetchError ? (
              <div className="p-6">
                <ErrorState
                  icon={AlertTriangle}
                  title="Failed to Load Verified Incidents"
                  message={incidentFetchError.message}
                  onRetry={fetchVerifiedIncidents}
                />
              </div>
            ) : verifiedIncidents.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  title="No Verified Incidents Awaiting Allocation"
                  description="All emergency incidents are currently reported, dispatched, or resolved. Check the Incident Queue to verify incoming citizen calls."
                  action={
                    <Link to="/control-room/incidents">
                      <Button variant="outline" size="sm">
                        Go to Incident Queue
                      </Button>
                    </Link>
                  }
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-theme-bg/80 border-b border-theme-border text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                      <th className="px-4 py-3 w-10 text-center">Select</th>
                      <th className="px-4 py-3">Incident ID</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3">Severity</th>
                      <th className="px-4 py-3">Casualties</th>
                      <th className="px-4 py-3">Location</th>
                      <th className="px-4 py-3">Reported Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-theme-border text-theme-heading">
                    {verifiedIncidents.map((inc) => {
                      const isSelected = selectedIncidentIds.includes(inc.incidentId);
                      return (
                        <tr
                          key={inc.incidentId}
                          onClick={() => toggleIncidentSelection(inc.incidentId)}
                          className={`hover:bg-theme-bg/60 transition-colors cursor-pointer ${
                            isSelected ? 'bg-blue-50/50' : ''
                          }`}
                        >
                          <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleIncidentSelection(inc.incidentId)}
                              className="rounded text-theme-primary focus:ring-theme-primary"
                            />
                          </td>
                          <td className="px-4 py-3 font-mono font-semibold text-theme-primary">
                            #{inc.incidentId}
                          </td>
                          <td className="px-4 py-3 font-semibold uppercase">
                            {inc.category?.replace(/_/g, ' ')}
                          </td>
                          <td className="px-4 py-3">
                            <SeverityBadge severity={inc.severity} />
                          </td>
                          <td className="px-4 py-3">
                            {inc.victimCount > 0 ? (
                              <span className="font-semibold text-amber-700">
                                {inc.victimCount} victim{inc.victimCount > 1 ? 's' : ''}
                              </span>
                            ) : (
                              <span className="text-gray-400">None reported</span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-gray-600 text-[11px]">
                            {inc.location
                              ? `${inc.location.latitude.toFixed(4)}, ${inc.location.longitude.toFixed(4)}`
                              : 'N/A'}
                          </td>
                          <td className="px-4 py-3 text-gray-500">
                            {new Date(inc.reportedAt).toLocaleTimeString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Step 2: Generated Recommendation Snapshot */}
          {currentRecommendation && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <Card>
                <Card.Header
                  title="Step 2: Review C++ Dispatch Recommendation"
                  subtitle={`Batch ID: ${currentRecommendation.batchId} · Status: ${currentRecommendation.batchStatus}`}
                  action={
                    <div className="flex items-center space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        icon={MapPin}
                        onClick={() => setShowMap(!showMap)}
                      >
                        {showMap ? 'Hide Map Routes' : 'Preview Route Geometry'}
                      </Button>
                      {currentRecommendation.confirmationStatus === 'CONFIRMED' ? (
                        <Badge variant="success" size="lg">
                          DISPATCH CONFIRMED
                        </Badge>
                      ) : isBatchFailed ? (
                        <Badge variant="danger" size="md">
                          Cannot Mobilize: 0 Vehicles Allocated (Batch Failed)
                        </Badge>
                      ) : (
                        <Button
                          variant="primary"
                          size="sm"
                          icon={CheckCheck}
                          onClick={handleOpenConfirm}
                        >
                          Confirm & Mobilize Fleet
                        </Button>
                      )}
                    </div>
                  }
                />

                {/* Failure Banner when 0 vehicles allocated or batch failed */}
                {isBatchFailed && currentRecommendation.confirmationStatus !== 'CONFIRMED' && (
                  <div className="p-4 bg-red-50/90 border-b border-red-200 text-xs text-red-900 flex items-start space-x-3">
                    <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-1">
                      <strong className="block font-semibold">Allocation Optimization Failed:</strong>
                      <p>
                        {currentRecommendation.batchStatusMessage ||
                          'Cannot Mobilize: 0 Vehicles Allocated (Batch Failed). Zero compatible emergency vehicles were assigned by the decision engine.'}
                      </p>
                      {currentRecommendation.incidentResults?.map((inc) => (
                        <div key={inc.incidentId} className="text-[11px] text-red-700">
                          • Incident #{inc.incidentId}: Allocation Status <code>{inc.allocationStatus}</code>
                          {inc.summaryNotes ? ` — ${inc.summaryNotes}` : ''}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Batch High-level Summary Cards */}
                <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 bg-gray-50 border-b border-theme-border text-xs">
                  <div className="bg-white p-3 rounded-lg border border-theme-border">
                    <span className="text-gray-500 block">Total Evaluated</span>
                    <strong className="text-base text-theme-heading">
                      {currentRecommendation.totalIncidents} incidents
                    </strong>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-theme-border">
                    <span className="text-gray-500 block">Fully Allocated</span>
                    <strong className="text-base text-emerald-700">
                      {currentRecommendation.fullyAllocatedCount} incidents
                    </strong>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-theme-border">
                    <span className="text-gray-500 block">Partially Allocated</span>
                    <strong className="text-base text-amber-700">
                      {currentRecommendation.partiallyAllocatedCount} incidents
                    </strong>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-theme-border">
                    <span className="text-gray-500 block">C++ Engine Wallclock</span>
                    <strong className="text-base text-theme-primary font-mono">
                      {currentRecommendation.engineTelemetry?.processWallClockMs
                        ? `${currentRecommendation.engineTelemetry.processWallClockMs} ms`
                        : `${currentRecommendation.engineMetadata?.totalExecutionTimeMs || 0} ms`}
                    </strong>
                  </div>
                </div>

                {/* Optional Interactive Route Map */}
                {showMap && (
                  <div className="p-4 border-b border-theme-border">
                    <div className="mb-2 text-xs text-gray-500 flex justify-between">
                      <span>Previewing shortest paths decoded from C++ polyline strings</span>
                      <span className="font-semibold text-theme-primary">
                        {mapPolylines.length} Route Legs Mapped
                      </span>
                    </div>
                    <MapContainer height="380px" showDefaultMarker={false}>
                      {mapPolylines.map((route) => (
                        <Polyline
                          key={route.key}
                          positions={route.coords}
                          pathOptions={{ color: route.color, weight: 4, opacity: 0.85 }}
                        />
                      ))}
                    </MapContainer>
                  </div>
                )}

                {/* Incident Results Detailed Breakdown */}
                <div className="p-4 space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-theme-heading">
                    Priority-Ordered Incident Allocations & Hospital Transfers
                  </h4>

                  {Array.isArray(currentRecommendation.incidentResults) &&
                    currentRecommendation.incidentResults.map((inc, idx) => (
                      <div
                        key={inc.incidentId}
                        className="p-4 rounded-xl border border-theme-border bg-white space-y-3 shadow-xs"
                      >
                        {/* Incident Header */}
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-2.5">
                          <div className="flex items-center space-x-2">
                            <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-700 font-bold text-xs flex items-center justify-center">
                              {inc.triageRank || idx + 1}
                            </span>
                            <Link
                              to={`/control-room/incidents/${inc.incidentId}`}
                              className="font-mono font-bold text-theme-primary hover:underline"
                            >
                              Incident #{inc.incidentId}
                            </Link>
                            <Badge variant="neutral" size="sm">
                              Score: {inc.priorityScore ? inc.priorityScore.toFixed(1) : 'N/A'}
                            </Badge>
                            {inc.priorityTier && (
                              <Badge variant="primary" size="sm">
                                {inc.priorityTier}
                              </Badge>
                            )}
                          </div>

                          <div>
                            <Badge
                              variant={
                                inc.allocationStatus === 'FULLY_ALLOCATED'
                                  ? 'success'
                                  : inc.allocationStatus === 'PARTIALLY_ALLOCATED'
                                  ? 'warning'
                                  : 'danger'
                              }
                              size="md"
                            >
                              {inc.allocationStatus?.replace(/_/g, ' ') || 'UNALLOCATED'}
                            </Badge>
                          </div>
                        </div>

                        {/* Assigned Fleet Units */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                          <div className="space-y-1.5 bg-gray-50 p-3 rounded-lg border border-gray-200">
                            <span className="font-semibold text-gray-700 flex items-center space-x-1.5">
                              <Truck className="w-3.5 h-3.5 text-theme-primary" />
                              <span>Recommended Vehicles ({inc.assignedResources?.length || 0})</span>
                            </span>

                            {Array.isArray(inc.assignedResources) && inc.assignedResources.length > 0 ? (
                              <ul className="space-y-1 mt-1">
                                {inc.assignedResources.map((r) => (
                                  <li
                                    key={r.resourceId}
                                    className="flex justify-between items-center text-[11px] bg-white p-1.5 rounded border border-gray-200"
                                  >
                                    <span className="font-semibold text-theme-heading">
                                      {r.resourceType} #{r.resourceId}
                                    </span>
                                    <span className="text-gray-500">
                                      ETA: ~{Math.round(r.estimatedArrivalSeconds / 60)} min ({((r.distanceMeters || 0) / 1000).toFixed(1)} km)
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-[11px] text-gray-500 italic">No compatible units available.</p>
                            )}

                            {/* Shortage Warnings */}
                            {Array.isArray(inc.resourceShortages) && inc.resourceShortages.length > 0 && (
                              <div className="mt-2 pt-2 border-t border-gray-200 space-y-1">
                                {inc.resourceShortages.map((s, sIdx) => (
                                  <div key={sIdx} className="text-[10px] text-red-700 flex items-center space-x-1">
                                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                                    <span>
                                      Shortage: {s.shortageQuantity} {s.resourceType} units unavailable
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Hospital Destination */}
                          <div className="space-y-1.5 bg-gray-50 p-3 rounded-lg border border-gray-200">
                            <span className="font-semibold text-gray-700 flex items-center space-x-1.5">
                              <Building2 className="w-3.5 h-3.5 text-teal-600" />
                              <span>Recommended Hospital</span>
                            </span>

                            {inc.recommendedHospital && inc.recommendedHospital.hospitalName ? (
                              <div className="space-y-1 bg-white p-2 rounded border border-gray-200 text-[11px]">
                                <div className="flex justify-between">
                                  <span className="font-semibold text-theme-heading">
                                    {inc.recommendedHospital.hospitalName}
                                  </span>
                                  <span className="text-gray-500">
                                    ETA: ~{Math.round(inc.recommendedHospital.estimatedTransportSeconds / 60)} min
                                  </span>
                                </div>
                                <div className="text-[10px] text-gray-600">
                                  Beds Allocated:{' '}
                                  <strong>{inc.recommendedHospital.allocatedGeneralBeds || 0} General</strong>,{' '}
                                  <strong>{inc.recommendedHospital.allocatedIcuBeds || 0} ICU</strong>
                                </div>
                              </div>
                            ) : (
                              <p className="text-[11px] text-gray-500 italic">
                                Hospital transport not required or no capacity available.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </Card>
            </div>
          )}
        </div>
      ) : (
        /* Batch History Tab */
        <Card>
          <Card.Header
            title="Recommendation Batch History"
            subtitle="Previous C++ optimization runs and persisted dispatch recommendation snapshots"
          />

          {isLoadingHistory ? (
            <div className="p-6 space-y-3">
              <Skeleton count={4} variant="tableRow" />
            </div>
          ) : historyError ? (
            <div className="p-6">
              <ErrorState
                icon={AlertTriangle}
                title="Failed to Load History"
                message={historyError.message}
                onRetry={fetchHistory}
              />
            </div>
          ) : historicalBatches.length === 0 ? (
            <div className="p-8">
              <EmptyState
                title="No Previous Optimization Batches"
                description="Run an optimization batch to persist dispatch recommendations."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-theme-bg/80 border-b border-theme-border text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    <th className="px-4 py-3">Batch ID</th>
                    <th className="px-4 py-3">Evaluated At</th>
                    <th className="px-4 py-3">Incidents</th>
                    <th className="px-4 py-3">Allocation Status</th>
                    <th className="px-4 py-3">Confirmation Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-theme-border text-theme-heading">
                  {historicalBatches.map((batch) => (
                    <tr key={batch.batchId} className="hover:bg-theme-bg/60 transition-colors">
                      <td className="px-4 py-3 font-mono font-semibold text-theme-primary">
                        {batch.batchId}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {new Date(batch.evaluatedAt || batch.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {batch.totalIncidents || batch.summary?.totalIncidentsReceived || 0} incidents
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={
                            batch.batchStatus === 'SUCCESS'
                              ? 'success'
                              : batch.batchStatus === 'PARTIAL_SUCCESS'
                              ? 'warning'
                              : 'danger'
                          }
                          size="sm"
                        >
                          {batch.batchStatus}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={batch.confirmationStatus === 'CONFIRMED' ? 'success' : 'neutral'}
                          size="sm"
                        >
                          {batch.confirmationStatus || 'PENDING'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          icon={ChevronRight}
                          onClick={() => handleViewHistorical(batch.batchId)}
                        >
                          Inspect
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* DISPATCH CONFIRMATION MODAL (Phase 5.6) */}
      <Modal
        isOpen={confirmModalOpen}
        onClose={() => {
          if (!isConfirming) setConfirmModalOpen(false);
        }}
        title="Confirm Dispatch Execution"
        subtitle={`Batch ID: ${currentRecommendation?.batchId}`}
      >
        <div className="space-y-4 text-xs">
          <div className="p-3 bg-blue-50/80 border border-blue-200 rounded-lg text-blue-900 leading-relaxed">
            <p className="font-semibold">Atomic Fleet Mobilization Protocol:</p>
            <p className="mt-1">
              Confirming executes a backend transaction to transition incidents to <strong>DISPATCHED</strong>, mobilize assigned emergency vehicles, and decrement hospital bed allocations.
            </p>
          </div>

          {confirmError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-900 flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <strong className="block font-semibold">Confirmation Error:</strong>
                <span>{confirmError}</span>
              </div>
            </div>
          )}

          <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-500">Total Incidents to Dispatch:</span>
              <strong className="text-theme-heading">
                {currentRecommendation?.totalIncidents} incidents
              </strong>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Fully Allocated:</span>
              <strong className="text-emerald-700">
                {currentRecommendation?.fullyAllocatedCount} incidents
              </strong>
            </div>
            {currentRecommendation?.partiallyAllocatedCount > 0 && (
              <div className="flex justify-between">
                <span className="text-amber-700">Partially Allocated:</span>
                <strong className="text-amber-700">
                  {currentRecommendation?.partiallyAllocatedCount} incidents
                </strong>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={allowPartialDispatch}
                onChange={(e) => setAllowPartialDispatch(e.target.checked)}
                className="rounded text-theme-primary focus:ring-theme-primary"
              />
              <span className="font-semibold text-theme-heading">
                Allow Partial Dispatch (mobilize available units even if some shortages exist)
              </span>
            </label>
          </div>

          <div className="space-y-1">
            <Textarea
              label="Operator Dispatch Notes (Optional)"
              placeholder="e.g., Radio broadcast confirmed with central police and medical control..."
              value={confirmationNotes}
              onChange={(e) => setConfirmationNotes(e.target.value)}
              maxLength={1000}
              rows={3}
            />
          </div>

          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-theme-border">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmModalOpen(false)}
              disabled={isConfirming}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={CheckCheck}
              onClick={handleConfirmDispatch}
              loading={isConfirming}
              disabled={isConfirming}
            >
              Confirm Dispatch
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default DispatchPlannerPage;
