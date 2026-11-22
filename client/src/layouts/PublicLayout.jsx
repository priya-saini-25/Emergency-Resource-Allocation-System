import React from 'react';
import { Outlet, Link } from 'react-router-dom';
import SimulationBanner from '../components/common/SimulationBanner.jsx';
import { Shield, Radio } from 'lucide-react';

export function PublicLayout() {
  return (
    <div className="min-h-screen bg-theme-bg flex flex-col font-sans">
      <SimulationBanner />

      <header className="bg-white border-b border-theme-border py-4 px-6 shadow-xs">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link to="/login" className="flex items-center space-x-2.5">
            <div className="p-2 bg-theme-sidebar text-white rounded-lg">
              <Shield className="w-5 h-5 text-theme-secondary" />
            </div>
            <div>
              <span className="font-bold text-sm tracking-tight text-theme-heading block">
                Emergency Resource Allocation & Response System
              </span>
              <span className="text-[11px] text-gray-500 block">
                Jodhpur Urban Service Area Decision Support
              </span>
            </div>
          </Link>

          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-1.5 text-xs text-gray-500">
              <Radio className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
              <span className="font-medium text-emerald-700">Dispatch Network Online</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <Outlet />
      </main>

      <footer className="py-4 text-center text-xs text-gray-500 border-t border-theme-border/60 bg-white">
        Emergency Resource Allocation & Response Management System · Academic Prototype (OSM Way 31725312)
      </footer>
    </div>
  );
}

export default PublicLayout;

