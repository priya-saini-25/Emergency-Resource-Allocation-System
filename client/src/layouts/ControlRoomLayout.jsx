import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import SimulationBanner from '../components/common/SimulationBanner.jsx';
import {
  ShieldAlert,
  LayoutDashboard,
  AlertOctagon,
  Send,
  Radio,
  Truck,
  Building2,
  Map,
  LogOut,
  User,
  Activity,
  Menu,
  X,
} from 'lucide-react';
import Button from '../components/ui/Button.jsx';
import Badge from '../components/ui/Badge.jsx';

export function ControlRoomLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const navItems = [
    { to: '/control-room/dashboard', label: 'Dashboard Overview', icon: LayoutDashboard },
    { to: '/control-room/incidents', label: 'Incident Queue', icon: AlertOctagon },
    { to: '/control-room/dispatch', label: 'Dispatch Planner', icon: Send },
    { to: '/control-room/active-incidents', label: 'Active Operations', icon: Radio },
    { to: '/control-room/resources', label: 'Resource Fleet', icon: Truck },
    { to: '/control-room/hospitals', label: 'Hospital Network', icon: Building2 },
    { to: '/control-room/map', label: 'Tactical Map', icon: Map },
  ];

  return (
    <div className="min-h-screen bg-theme-bg flex flex-col font-sans">
      <SimulationBanner />

      <div className="flex-1 flex flex-row relative overflow-hidden">
        {/* Mobile Sidebar Backdrop */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-slate-900/60 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar (Dark Slate #252F3B) */}
        <aside
          className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-theme-sidebar text-white flex flex-col transition-transform duration-200 ease-in-out border-r border-slate-700/60 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          }`}
        >
          {/* Sidebar Header */}
          <div className="p-4 border-b border-slate-700/80 flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="p-1.5 bg-theme-primary/20 text-theme-secondary rounded-lg border border-theme-secondary/30">
                <ShieldAlert className="w-5 h-5 text-theme-secondary" />
              </div>
              <div>
                <span className="font-bold text-sm tracking-tight text-white block">
                  Jodhpur Control Room
                </span>
                <span className="text-[10px] text-slate-400 block tracking-wider uppercase font-medium">
                  Dispatch Command Center
                </span>
              </div>
            </div>
            <button
              type="button"
              className="lg:hidden text-slate-400 hover:text-white"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            <span className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
              Operational Modules
            </span>
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setSidebarOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center space-x-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                      isActive
                        ? 'bg-slate-700/80 text-white font-semibold border-l-3 border-theme-primary shadow-xs'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                    }`
                  }
                >
                  <Icon className="w-4 h-4 flex-shrink-0 text-theme-secondary" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>

          {/* Sidebar Footer / System Badge */}
          <div className="p-4 border-t border-slate-700/80 bg-slate-800/40">
            <div className="flex items-center space-x-2 text-[11px] text-slate-300 mb-2">
              <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <span>C++ Engine Bridge: v1.0</span>
            </div>
            <p className="text-[10px] text-slate-400 leading-tight">
              Dijkstra routing · SpatialGrid · Multi-doc ACID
            </p>
          </div>
        </aside>

        {/* Content Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          {/* Top Bar */}
          <header className="bg-white border-b border-theme-border h-16 flex items-center justify-between px-4 sm:px-6 sticky top-0 z-20 shadow-xs">
            <div className="flex items-center space-x-3">
              <button
                type="button"
                className="lg:hidden p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                onClick={() => setSidebarOpen(true)}
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="hidden sm:flex items-center space-x-2">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                  Live Dispatch Simulation
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2 text-xs text-gray-700 pr-2 border-r border-theme-border">
                <div className="p-1.5 bg-theme-bg-secondary rounded-full text-theme-sidebar">
                  <User className="w-3.5 h-3.5" />
                </div>
                <div className="text-left hidden sm:block">
                  <span className="font-semibold block text-theme-heading leading-tight">
                    {user?.name || 'Operator Officer'}
                  </span>
                  <span className="text-[10px] text-gray-500 block leading-tight">
                    {user?.email || 'operator@jodhpur.emergency.gov.in'}
                  </span>
                </div>
                <Badge size="sm" variant="primary">
                  {user?.role || 'OPERATOR'}
                </Badge>
              </div>

              <Button
                variant="outline"
                size="sm"
                icon={LogOut}
                onClick={handleLogout}
                className="text-xs"
              >
                Sign Out
              </Button>
            </div>
          </header>

          {/* Main Dashboard Content */}
          <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

export default ControlRoomLayout;

