import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/ui/PageHeader.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import StatusBadge, { SeverityBadge } from '../../components/ui/StatusBadge.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import EmptyState, { ErrorState } from '../../components/ui/EmptyState.jsx';
import MapContainer from '../../components/map/MapContainer.jsx';
import incidentService from '../../services/incidentService.js';
import {
  AlertOctagon,
  Flame,
  Truck,
  Building2,
  Send,
  Radio,
  Clock,
  ArrowRight,
  Shield,
  Layers,
  RotateCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';

export function ControlRoomDashboard() {
  const [metrics, setMetrics] = useState({
    totalIncidents: 0,
    pendingReported: 0,
    verifiedCount: 0,
    rejectedCount: 0,
  });

  const [recentIncidents, setRecentIncidents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDashboardData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Parallel queries: genuine global MongoDB aggregation stats + recent 5 records feed
      const [statsRes, recentRes] = await Promise.all([
        incidentService.getIncidentStats(),
        incidentService.listIncidents({ limit: 5, sortBy: 'createdAt', sortOrder: 'desc' }),
      ]);

      const stats = statsRes.data || statsRes;

      setMetrics({
        totalIncidents: stats?.totalIncidents ?? 0,
        pendingReported: stats?.pendingReported ?? 0,
        verifiedCount: stats?.verifiedCount ?? 0,
        rejectedCount: stats?.rejectedCount ?? 0,
      });

      setRecentIncidents(recentRes.incidents || []);
      setIsLoading(false);
    } catch (err) {
      setError(err);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Command & Dispatch Control Room"
        subtitle="Jodhpur Urban Service Area · Multi-incident Decision Support & Fleet Optimization"
        badge={<Badge variant="primary">Authoritative Control</Badge>}
        actions={
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              icon={RotateCw}
              onClick={fetchDashboardData}
              disabled={isLoading}
            >
              Refresh
            </Button>
            <Link to="/control-room/incidents">
              <Button variant="secondary" size="sm" icon={AlertOctagon}>
                Review Queue
              </Button>
            </Link>
            <Link to="/control-room/dispatch">
              <Button variant="primary" size="sm" icon={Send}>
                Dispatch Planner
              </Button>
            </Link>
            <Link to="/control-room/map">
              <Button variant="outline" size="sm" icon={Layers}>
                Tactical Map
              </Button>
            </Link>
          </div>
        }
      />

      {/* Simulation Notice Banner */}
      <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3.5 flex items-center justify-between text-xs text-amber-900">
        <div className="flex items-center space-x-2.5">
          <Shield className="w-4 h-4 text-amber-700 flex-shrink-0" />
          <span>
            <strong>DEMO SIMULATION — NOT CONNECTED TO LIVE EMERGENCY SERVICES.</strong> Control room operators review incoming reports, perform triage, and trigger algorithmic fleet allocation.
          </span>
        </div>
        <Badge variant="warning" size="sm">
          Academic Simulation
        </Badge>
      </div>

      {/* Metric Cards (Authoritative Database Counts) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          <>
            <Skeleton variant="card" />
            <Skeleton variant="card" />
            <Skeleton variant="card" />
            <Skeleton variant="card" />
          </>
        ) : (
          <>
            <StatCard
              title="Total Logged Incidents"
              value={metrics.totalIncidents.toString()}
              subtitle="Global MongoDB aggregate count"
              icon={Radio}
              indicatorColor="#5685B5"
            />
            <StatCard
              title="Pending Verification"
              value={metrics.pendingReported.toString()}
              subtitle="Global count in REPORTED status"
              icon={AlertOctagon}
              indicatorColor="#E89543"
              trend={metrics.pendingReported > 0 ? 'Requires Action' : 'Queue Clear'}
            />
            <StatCard
              title="Verified Incidents"
              value={metrics.verifiedCount.toString()}
              subtitle="Global count in VERIFIED status"
              icon={CheckCircle2}
              indicatorColor="#56866B"
            />
            <StatCard
              title="Rejected False Alarms"
              value={metrics.rejectedCount.toString()}
              subtitle="Global count in REJECTED status"
              icon={XCircle}
              indicatorColor="#DC4545"
            />
          </>
        )}
      </div>

      {/* Operational Split View: Geospatial Map + Live Recent Incident Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Interactive Map Component with OSM Boundary */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <Card.Header
              title="Geospatial Tactical Map"
              subtitle="Jodhpur Urban Settlement Boundary (26.2918° N, 73.0168° E)"
              action={
                <Link to="/control-room/map" className="text-xs font-semibold text-theme-primary hover:underline flex items-center space-x-1">
                  <Layers className="w-3.5 h-3.5 inline mr-1" />
                  <span>Full Tactical Map</span>
                </Link>
              }
            />
            <div className="p-3">
              <MapContainer
                height="340px"
                zoom={12}
                markerTitle="Jodhpur Command Center"
              />
            </div>
            <Card.Footer className="text-[11px] text-gray-500 flex justify-between">
              <span>Road graph: 59,334 nodes · 129,778 edges</span>
              <span className="font-semibold text-emerald-700">OSM Online</span>
            </Card.Footer>
          </Card>
        </div>

        {/* Right Column: Active Live Incident Feed */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <Card.Header
              title="Live Recent Incidents"
              subtitle="Most recent emergency records from the central dispatch database"
              action={
                <Link
                  to="/control-room/incidents"
                  className="text-xs font-semibold text-theme-primary hover:underline flex items-center space-x-1"
                >
                  <span>Full Queue</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              }
            />

            {error ? (
              <div className="p-6">
                <ErrorState
                  icon={AlertTriangle}
                  title="Failed to Load Recent Incidents"
                  message={error.message || 'Error communicating with control-room API.'}
                  onRetry={fetchDashboardData}
                />
              </div>
            ) : isLoading ? (
              <div className="p-4 space-y-2">
                <Skeleton count={4} variant="tableRow" />
              </div>
            ) : recentIncidents.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  title="No Incidents Reported"
                  description="No emergency incidents have been recorded in the database yet."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-theme-bg/80 border-b border-theme-border text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                      <th className="px-4 py-3">Incident</th>
                      <th className="px-4 py-3">Severity</th>
                      <th className="px-4 py-3">Location</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-theme-border text-theme-heading">
                    {recentIncidents.map((inc) => (
                      <tr key={inc.incidentId} className="hover:bg-theme-bg/60 transition-colors">
                        <td className="px-4 py-3">
                          <Link
                            to={`/control-room/incidents/${inc.incidentId}`}
                            className="font-mono font-semibold text-theme-primary hover:underline block"
                          >
                            #{inc.incidentId}
                          </Link>
                          <span className="text-[11px] text-gray-500 uppercase">
                            {inc.category ? inc.category.replace(/_/g, ' ') : 'EMERGENCY'}
                            {inc.victimCount > 0 ? ` · ${inc.victimCount} victims` : ''}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <SeverityBadge severity={inc.severity} />
                        </td>
                        <td className="px-4 py-3 text-gray-600 font-mono text-[11px] truncate max-w-[140px]">
                          {inc.location
                            ? `${inc.location.latitude.toFixed(4)}, ${inc.location.longitude.toFixed(4)}`
                            : 'N/A'}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={inc.status} size="sm" />
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <Link to={`/control-room/incidents/${inc.incidentId}`}>
                            <Button variant="outline" size="sm" icon={ExternalLink}>
                              {inc.status === 'REPORTED' ? 'Verify' : 'Inspect'}
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <Card.Footer className="text-xs text-gray-500 flex justify-between items-center">
              <span>Database query: `GET /api/incidents/stats` & `GET /api/incidents?limit=5`</span>
              <span className="text-theme-primary font-medium">Global MongoDB Aggregation & Live Feed</span>
            </Card.Footer>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default ControlRoomDashboard;
