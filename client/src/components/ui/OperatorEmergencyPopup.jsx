import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotification } from '../../context/NotificationContext.jsx';
import { ShieldAlert, AlertTriangle, MapPin, Clock, ArrowRight, X } from 'lucide-react';
import Badge from './Badge.jsx';

export function OperatorEmergencyPopup() {
  const { operatorPopups, dismissPopup } = useNotification();
  const navigate = useNavigate();

  if (!operatorPopups || operatorPopups.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Urgent Incoming Emergencies"
      className="fixed bottom-4 right-4 z-50 flex flex-col space-y-3 max-w-md w-full pointer-events-none"
    >
      {operatorPopups.map((popup) => {
        const timeStr = popup.reportedAt ? new Date(popup.reportedAt).toLocaleTimeString() : 'Just now';
        const formattedCategory = String(popup.category || 'EMERGENCY').replace(/_/g, ' ');

        return (
          <div
            key={popup.id}
            role="alert"
            className="pointer-events-auto bg-white border-2 border-red-500 rounded-xl shadow-2xl p-4 transition-all transform duration-300 ease-out animate-bounce-short"
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
              <div className="flex items-center space-x-2">
                <span className="flex h-3 w-3 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600"></span>
                </span>
                <span className="font-bold text-sm text-red-700 uppercase tracking-wide flex items-center space-x-1">
                  <ShieldAlert className="w-4 h-4 text-red-600 inline" />
                  <span>New Emergency Report</span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => dismissPopup(popup.id)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition-colors"
                title="Dismiss popup"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Incident Summary */}
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-gray-800">
                  Incident #{popup.incidentId}
                </span>
                <div className="flex items-center space-x-1.5">
                  <Badge variant="critical">
                    P{popup.severity} · SEV {popup.severity}
                  </Badge>
                  <Badge variant="outline">
                    {formattedCategory}
                  </Badge>
                </div>
              </div>

              {/* Location */}
              <div className="flex items-start space-x-2 text-xs text-gray-700">
                <MapPin className="w-3.5 h-3.5 text-gray-500 flex-shrink-0 mt-0.5" />
                <span className="truncate">
                  {popup.address || popup.landmark || 'Paota / Jodhpur Urban Area'}
                </span>
              </div>

              {/* Timestamp */}
              <div className="flex items-center space-x-2 text-[11px] text-gray-500">
                <Clock className="w-3 h-3 text-gray-400 flex-shrink-0" />
                <span>Submitted at {timeStr}</span>
              </div>
            </div>

            {/* Action Footer */}
            <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center justify-end space-x-2">
              <button
                type="button"
                onClick={() => dismissPopup(popup.id)}
                className="px-2.5 py-1 text-xs text-gray-600 hover:text-gray-800 font-medium rounded hover:bg-gray-50 transition-colors"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={() => {
                  dismissPopup(popup.id);
                  navigate(`/control-room/incidents/${popup.incidentId}`);
                }}
                className="inline-flex items-center space-x-1 px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
              >
                <span>Open Incident</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default OperatorEmergencyPopup;
