import React, { useState } from 'react';
import { ShieldAlert, Server, Cpu, Database, Activity, MapPin, CheckCircle2 } from 'lucide-react';

function App() {
  const [healthData, setHealthData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const checkBackendHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/health');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setHealthData(data);
    } catch (err) {
      setError(err.message || 'Failed to connect to backend server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-theme-bg text-theme-heading flex flex-col font-sans">
      {/* Simulation Banner */}
      <div className="bg-theme-sidebar text-white text-xs px-4 py-2 flex items-center justify-between border-b border-theme-border">
        <div className="flex items-center space-x-2">
          <ShieldAlert className="w-4 h-4 text-emergency-high" />
          <span className="font-medium tracking-wide">
            ACADEMIC PROTOTYPE & SIMULATION ONLY: Not connected to actual government or live emergency services.
          </span>
        </div>
        <div className="flex items-center space-x-1 text-theme-secondary text-xs">
          <MapPin className="w-3.5 h-3.5" />
          <span>Jodhpur City, Rajasthan</span>
        </div>
      </div>

      {/* Header */}
      <header className="bg-theme-card border-b border-theme-border px-8 py-5 shadow-sm">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-theme-heading">
              Emergency Resource Allocation & Response Management System
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Phase 1: Project Initialization & Architectural Verification
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emergency-available border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emergency-available mr-1.5 animate-pulse"></span>
              Phase 1 Active
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-8 py-8 flex-1 w-full space-y-6">
        {/* Architectural Corrections Overview Card */}
        <section className="bg-theme-card border border-theme-border rounded-xl p-6 shadow-sm">
          <h2 className="text-base font-semibold text-theme-heading flex items-center space-x-2 mb-3">
            <CheckCircle2 className="w-5 h-5 text-theme-primary" />
            <span>Architecture & Standardized System Foundation</span>
          </h2>
          <p className="text-sm text-gray-600 leading-relaxed mb-4">
            The system is initialized strictly according to the six architectural corrections: authentic Jodhpur GeoJSON boundaries, real OpenStreetMap road topology, explicit multi-criteria priority queue triage, compatible atomic fleet allocation, capacity-aware hospital recommendations, and standardized incident lifecycles.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <div className="p-4 rounded-lg bg-theme-bg border border-theme-border">
              <span className="text-xs font-semibold uppercase tracking-wider text-theme-primary block mb-1">Geographic Scope</span>
              <p className="text-sm font-medium text-theme-heading">Jodhpur Metropolitan Polygon</p>
              <span className="text-xs text-gray-500">Point-in-polygon verification</span>
            </div>
            <div className="p-4 rounded-lg bg-theme-bg border border-theme-border">
              <span className="text-xs font-semibold uppercase tracking-wider text-theme-primary block mb-1">Algorithmic Engine</span>
              <p className="text-sm font-medium text-theme-heading">C++17 Standalone Binary</p>
              <span className="text-xs text-gray-500">Dijkstra, Min-Heap, Priority Queue</span>
            </div>
            <div className="p-4 rounded-lg bg-theme-bg border border-theme-border">
              <span className="text-xs font-semibold uppercase tracking-wider text-theme-primary block mb-1">Design System</span>
              <p className="text-sm font-medium text-theme-heading">Slate × Ice Blue Theme</p>
              <span className="text-xs text-gray-500">Tokens & Status Indicators</span>
            </div>
          </div>
        </section>

        {/* Stack Component Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-theme-card border border-theme-border rounded-xl p-5 shadow-sm">
            <div className="flex items-center space-x-3 mb-2">
              <div className="p-2 bg-theme-bg-secondary rounded-lg text-theme-heading">
                <Activity className="w-5 h-5 text-theme-primary" />
              </div>
              <div>
                <h3 className="text-sm font-bold">Frontend</h3>
                <span className="text-xs text-gray-500">React 18 + Vite</span>
              </div>
            </div>
            <p className="text-xs text-gray-600 mt-2">Tailwind CSS initialized with Slate × Ice Blue design tokens.</p>
          </div>

          <div className="bg-theme-card border border-theme-border rounded-xl p-5 shadow-sm">
            <div className="flex items-center space-x-3 mb-2">
              <div className="p-2 bg-theme-bg-secondary rounded-lg text-theme-heading">
                <Server className="w-5 h-5 text-theme-primary" />
              </div>
              <div>
                <h3 className="text-sm font-bold">Backend API</h3>
                <span className="text-xs text-gray-500">Node.js + Express</span>
              </div>
            </div>
            <p className="text-xs text-gray-600 mt-2">REST API entry point configured with health check and error middleware.</p>
          </div>

          <div className="bg-theme-card border border-theme-border rounded-xl p-5 shadow-sm">
            <div className="flex items-center space-x-3 mb-2">
              <div className="p-2 bg-theme-bg-secondary rounded-lg text-theme-heading">
                <Cpu className="w-5 h-5 text-theme-primary" />
              </div>
              <div>
                <h3 className="text-sm font-bold">DSA Engine</h3>
                <span className="text-xs text-gray-500">C++17 Standalone</span>
              </div>
            </div>
            <p className="text-xs text-gray-600 mt-2">CLI diagnostic entry point verified with stdin/stdout JSON protocol.</p>
          </div>

          <div className="bg-theme-card border border-theme-border rounded-xl p-5 shadow-sm">
            <div className="flex items-center space-x-3 mb-2">
              <div className="p-2 bg-theme-bg-secondary rounded-lg text-theme-heading">
                <Database className="w-5 h-5 text-theme-primary" />
              </div>
              <div>
                <h3 className="text-sm font-bold">Database</h3>
                <span className="text-xs text-gray-500">MongoDB Ready</span>
              </div>
            </div>
            <p className="text-xs text-gray-600 mt-2">Schema definitions prepared for incident lifecycle and fleet tracking.</p>
          </div>
        </div>

        {/* Backend Health Check Verification Section */}
        <section className="bg-theme-card border border-theme-border rounded-xl p-6 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
            <div>
              <h3 className="text-base font-bold text-theme-heading">Backend Connectivity Verification</h3>
              <p className="text-xs text-gray-500 mt-0.5">Test communication with Express endpoint <code className="bg-theme-bg px-1.5 py-0.5 rounded text-theme-heading border border-theme-border">GET /api/health</code></p>
            </div>
            <button
              onClick={checkBackendHealth}
              disabled={loading}
              className="px-4 py-2 bg-theme-sidebar text-white text-xs font-semibold rounded-lg hover:bg-slate-700 transition duration-150 disabled:opacity-50"
            >
              {loading ? 'Querying...' : 'Ping Backend Health'}
            </button>
          </div>

          {healthData && (
            <div className="mt-4 p-4 rounded-lg bg-slate-900 text-slate-100 font-mono text-xs border border-slate-700">
              <div className="text-emerald-400 font-bold mb-2">200 OK — Backend Responded Successfully:</div>
              <pre>{JSON.stringify(healthData, null, 2)}</pre>
            </div>
          )}

          {error && (
            <div className="mt-4 p-4 rounded-lg bg-red-50 text-emergency-critical border border-red-200 text-xs">
              <span className="font-bold">Connection Notice:</span> {error} (Ensure backend server is running on port 5000)
            </div>
          )}
        </section>

        {/* Emergency Status Indicators Showcase */}
        <section className="bg-theme-card border border-theme-border rounded-xl p-6 shadow-sm">
          <h3 className="text-sm font-bold text-theme-heading mb-3">Approved Emergency Status Palette Tokens</h3>
          <div className="flex flex-wrap gap-2">
            <span className="px-3 py-1 text-xs font-medium text-white rounded-md bg-[#DC4545]">Critical (#DC4545)</span>
            <span className="px-3 py-1 text-xs font-medium text-white rounded-md bg-[#E89543]">High (#E89543)</span>
            <span className="px-3 py-1 text-xs font-medium text-white rounded-md bg-[#D5B34F]">Medium (#D5B34F)</span>
            <span className="px-3 py-1 text-xs font-medium text-white rounded-md bg-[#56866B]">Available (#56866B)</span>
            <span className="px-3 py-1 text-xs font-medium text-white rounded-md bg-[#5685B5]">Dispatched (#5685B5)</span>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-theme-border bg-theme-card py-4 text-center text-xs text-gray-500">
        Emergency Resource Allocation & Response Management System • Jodhpur City Academic Simulation • Phase 1
      </footer>
    </div>
  );
}

export default App;
