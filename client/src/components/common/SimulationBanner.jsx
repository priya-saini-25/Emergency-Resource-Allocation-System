import React from 'react';
import { ShieldAlert, MapPin } from 'lucide-react';

/**
 * Academic Simulation Disclaimer Banner Component
 */
export function SimulationBanner() {
  return (
    <div className="bg-theme-sidebar text-white text-xs px-4 py-1.5 flex items-center justify-between border-b border-theme-border flex-wrap gap-2 select-none">
      <div className="flex items-center space-x-2">
        <ShieldAlert className="w-3.5 h-3.5 text-emergency-high flex-shrink-0" />
        <span className="font-semibold tracking-wide text-gray-200">
          DEMO SIMULATION — NOT CONNECTED TO LIVE EMERGENCY SERVICES
        </span>
      </div>
      <div className="flex items-center space-x-1.5 text-theme-secondary text-xs">
        <MapPin className="w-3 h-3 text-theme-primary flex-shrink-0" />
        <span className="tracking-wide">Jodhpur Urban Service Area, Rajasthan</span>
      </div>
    </div>
  );
}

export default SimulationBanner;

