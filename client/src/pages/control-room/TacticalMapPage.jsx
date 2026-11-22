import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import StatusBadge, { SeverityBadge } from '../../components/ui/StatusBadge.jsx';
import MapContainer from '../../components/map/MapContainer.jsx';
import { Marker, Popup } from 'react-leaflet';
import { incidentIcon, resourceIcon, hospitalIcon, getStationDisplayName } from '../../components/map/mapIcons.js';
import incidentService from '../../services/incidentService.js';
import resourceService from '../../services/resourceService.js';
import hospitalService from '../../services/hospitalService.js';
import {
  MapPin,
  Truck,
  Building2,
  RotateCw,
  Layers,
  Filter,
  Shield,
  AlertTriangle,
  ExternalLink,
  Radio,
  Eye,
  EyeOff,
  Maximize2,
} from 'lucide-react';

export function TacticalMapPage() {
  const [incidents, setIncidents] = useState([]);
  const [resources, setResources] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Layer Toggles
  const [showIncidents, setShowIncidents] = useState(true);
  const [showResources, setShowResources] = useState(true);
  const [showHospitals, setShowHospitals] = useState(true);
  const [incidentStatusFilter, setIncidentStatusFilter] = useState('ACTIVE'); // 'ALL', 'ACTIVE', 'REPORTED', 'VERIFIED'

  const fetchMapEntities = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [incRes, resData, hospData] = await Promise.all([
        incidentService.listIncidents({ limit: 50 }),
        resourceService.listResources({ limit: 50 }),
        hospitalService.listHospitals({ limit: 20 }),
      ]);

      setIncidents(incRes.incidents || []);
      setResources(resData.resources || []);
      setHospitals(hospData.hospitals || []);
      setIsLoading(false);
    } catch (err) {
      setError(err);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMapEntities();
  }, [fetchMapEntities]);

  // Filter incidents for map display
  const filteredIncidents = incidents.filter((inc) => {
    if (!inc.location || !Number.isFinite(inc.location.latitude) || !Number.isFinite(inc.location.longitude)) {
      return false;
    }
    if (incidentStatusFilter === 'ACTIVE') {
      return ['REPORTED', 'VERIFIED', 'ALLOCATED', 'DISPATCHED', 'ON_SCENE'].includes(inc.status);
    }
    if (incidentStatusFilter === 'REPORTED') return inc.status === 'REPORTED';
    if (incidentStatusFilter === 'VERIFIED') return inc.status === 'VERIFIED';
    return true; // 'ALL'
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Integrated Geospatial Tactical Command Map"
        subtitle="Live emergency incident clusters, stationary depot fleets, and trauma hospital network · Jodhpur Urban Area"
        badge={<Badge variant="primary">Tactical Map</Badge>}
        actions={
          <div className="flex items-center space-x-2">
            <Button variant="secondary" size="sm" icon={RotateCw} onClick={fetchMapEntities} disabled={isLoading}>
              Refresh Entities
            </Button>
          </div>
        }
      />

      {/* Simulation Banner */}
      <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3.5 flex items-center justify-between text-xs text-amber-900">
        <div className="flex items-center space-x-2.5">
          <Shield className="w-4 h-4 text-amber-700 flex-shrink-0" />
          <span>
            <strong>DEMO SIMULATION — NOT CONNECTED TO LIVE EMERGENCY SERVICES.</strong> Marker positions represent authentic OSM coordinates within the Jodhpur Urban Settlement polygon. Vehicle locations indicate base depots rather than live GPS feeds.
          </span>
        </div>
        <Badge variant="warning" size="sm">Academic Simulation</Badge>
      </div>

      {/* Layer Control Bar */}
      <div className="p-3.5 bg-white border border-theme-border rounded-xl shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-gray-500 mr-1 flex items-center space-x-1">
            <Layers className="w-3.5 h-3.5 text-theme-primary" />
            <span>Map Layers:</span>
          </span>

          <button
            type="button"
            onClick={() => setShowIncidents(!showIncidents)}
            className={`px-3 py-1.5 rounded-lg border flex items-center space-x-1.5 font-semibold transition-all ${
              showIncidents
                ? 'bg-red-50 text-red-800 border-red-300'
                : 'bg-gray-100 text-gray-400 border-gray-200 line-through'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-red-600 inline-block" />
            <span>Emergencies ({filteredIncidents.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setShowResources(!showResources)}
            className={`px-3 py-1.5 rounded-lg border flex items-center space-x-1.5 font-semibold transition-all ${
              showResources
                ? 'bg-blue-50 text-blue-800 border-blue-300'
                : 'bg-gray-100 text-gray-400 border-gray-200 line-through'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-blue-600 inline-block" />
            <span>Fleet Depots ({resources.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setShowHospitals(!showHospitals)}
            className={`px-3 py-1.5 rounded-lg border flex items-center space-x-1.5 font-semibold transition-all ${
              showHospitals
                ? 'bg-teal-50 text-teal-800 border-teal-300'
                : 'bg-gray-100 text-gray-400 border-gray-200 line-through'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-teal-600 inline-block" />
            <span>Hospitals ({hospitals.length})</span>
          </button>
        </div>

        {/* Status filter for incidents */}
        <div className="flex items-center space-x-1">
          <span className="text-gray-500 font-medium mr-1">Filter Emergencies:</span>
          {['ACTIVE', 'REPORTED', 'VERIFIED', 'ALL'].map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setIncidentStatusFilter(status)}
              className={`px-2.5 py-1 text-[11px] rounded font-semibold transition-colors ${
                incidentStatusFilter === status
                  ? 'bg-theme-sidebar text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Main Tactical Map Display */}
      <Card className="p-0 overflow-hidden border border-theme-border shadow-md">
        <MapContainer height="620px" showDefaultMarker={false}>
          {/* Incident Markers */}
          {showIncidents &&
            filteredIncidents.map((inc) => (
              <Marker
                key={`inc_${inc.incidentId}`}
                position={[inc.location.latitude, inc.location.longitude]}
                icon={incidentIcon(inc.severity, inc.status)}
              >
                <Popup>
                  <div className="text-xs p-1 space-y-1 max-w-[220px]">
                    <div className="flex items-center justify-between border-b pb-1">
                      <span className="font-mono font-bold text-theme-primary">
                        #{inc.incidentId}
                      </span>
                      <StatusBadge status={inc.status} size="sm" />
                    </div>
                    <div className="font-semibold uppercase text-theme-heading text-[11px]">
                      {inc.category?.replace(/_/g, ' ')}
                    </div>
                    <div className="text-gray-600 text-[11px]">
                      Severity Level: <strong>{inc.severity}</strong> · Casualties: <strong>{inc.victimCount || 0}</strong>
                    </div>
                    {inc.description && (
                      <p className="text-[10px] text-gray-500 italic truncate">
                        "{inc.description}"
                      </p>
                    )}
                    <div className="pt-1.5 border-t flex justify-end">
                      <Link
                        to={`/control-room/incidents/${inc.incidentId}`}
                        className="text-theme-primary font-semibold hover:underline flex items-center space-x-1 text-[11px]"
                      >
                        <span>Open Details</span>
                        <ExternalLink className="w-3 h-3 ml-0.5" />
                      </Link>
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}

          {/* Resource Markers */}
          {showResources &&
            resources.map((res) => {
              if (!res.location || !Number.isFinite(res.location.latitude) || !Number.isFinite(res.location.longitude)) {
                return null;
              }
              return (
                <Marker
                  key={`res_${res.resourceId}`}
                  position={[res.location.latitude, res.location.longitude]}
                  icon={resourceIcon(res.resourceType, res.status)}
                >
                  <Popup>
                    <div className="text-xs p-1 space-y-1.5 max-w-[240px]">
                      <div className="flex items-center justify-between border-b pb-1">
                        <span className="font-mono font-bold text-theme-heading">
                          Unit #{res.resourceId}
                        </span>
                        <Badge
                          variant={res.status === 'AVAILABLE' ? 'success' : 'primary'}
                          size="sm"
                        >
                          {res.status}
                        </Badge>
                      </div>
                      <div className="font-semibold text-gray-800 text-[11px]">
                        {res.name || res.resourceType?.replace(/_/g, ' ')}
                      </div>
                      <div className="text-[10px] text-gray-600 bg-slate-50 p-1.5 rounded border border-gray-100">
                        <strong className="block text-gray-700">
                          {getStationDisplayName(res.stationId, res.name)}
                        </strong>
                        <span className="text-[9px] text-gray-400 block mt-0.5 italic">
                          Stationary base depot · Not live vehicle GPS
                        </span>
                      </div>
                      {res.assignedIncidentId && (
                        <div className="text-[11px] text-amber-800 font-medium">
                          Active: Incident #{res.assignedIncidentId}
                        </div>
                      )}
                    </div>
                  </Popup>
                </Marker>
              );
            })}

          {/* Hospital Markers */}
          {showHospitals &&
            hospitals.map((hosp) => {
              if (!hosp.location || !Number.isFinite(hosp.location.latitude) || !Number.isFinite(hosp.location.longitude)) {
                return null;
              }
              return (
                <Marker
                  key={`hosp_${hosp.hospitalId}`}
                  position={[hosp.location.latitude, hosp.location.longitude]}
                  icon={hospitalIcon()}
                >
                  <Popup>
                    <div className="text-xs p-1 space-y-1 max-w-[220px]">
                      <div className="border-b pb-1">
                        <strong className="block text-theme-heading">{hosp.name}</strong>
                        <span className="text-[10px] text-gray-400 font-mono">
                          ID: #{hosp.hospitalId} · {hosp.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-emerald-800 font-semibold">
                        Beds: {hosp.availableBeds} available / {hosp.totalBeds} total
                      </div>
                      <div className="text-[10px] text-gray-600">
                        ICU Beds: {hosp.icuBeds?.available || 0} / {hosp.icuBeds?.total || 0}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
        </MapContainer>

        {/* Map Legend Footer */}
        <div className="p-3.5 bg-gray-50 border-t border-theme-border flex flex-wrap items-center justify-between gap-3 text-xs text-gray-600">
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-semibold text-theme-heading">Legend:</span>
            <div className="flex items-center space-x-1">
              <span className="w-3 h-3 rounded-full bg-[#DC4545] inline-block" />
              <span>Critical Emergency (P5)</span>
            </div>
            <div className="flex items-center space-x-1">
              <span className="w-3 h-3 rounded-full bg-[#E89543] inline-block" />
              <span>High Emergency (P4)</span>
            </div>
            <div className="flex items-center space-x-1">
              <span className="w-3 h-3 rounded-full bg-[#56866B] inline-block" />
              <span>Available Unit (Green)</span>
            </div>
            <div className="flex items-center space-x-1">
              <span className="w-3 h-3 rounded-full bg-[#5685B5] inline-block" />
              <span>Dispatched Unit (Blue)</span>
            </div>
            <div className="flex items-center space-x-1">
              <span className="w-3 h-3 rounded-full bg-[#0D9488] inline-block" />
              <span>Hospital Facility (Teal)</span>
            </div>
          </div>

          <div className="text-[11px] text-gray-500 font-mono">
            Boundary: OSM Way 31725312 Proxy · Road Graph: 59,334 nodes
          </div>
        </div>
      </Card>
    </div>
  );
}

export default TacticalMapPage;

