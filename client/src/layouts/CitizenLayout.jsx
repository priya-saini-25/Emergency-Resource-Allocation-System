import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import SimulationBanner from '../components/common/SimulationBanner.jsx';
import { Shield, Home, PlusCircle, Clock, LogOut, User } from 'lucide-react';
import Button from '../components/ui/Button.jsx';
import Badge from '../components/ui/Badge.jsx';

export function CitizenLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const navItems = [
    { to: '/citizen/dashboard', label: 'Dashboard', icon: Home },
    { to: '/citizen/report-emergency', label: 'Report Emergency', icon: PlusCircle },
    { to: '/citizen/my-incidents', label: 'My Reports', icon: Clock },
  ];

  return (
    <div className="min-h-screen bg-theme-bg flex flex-col font-sans">
      <SimulationBanner />

      <header className="bg-white border-b border-theme-border sticky top-0 z-30 shadow-xs">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 bg-theme-sidebar text-white rounded-lg">
                <Shield className="w-5 h-5 text-theme-secondary" />
              </div>
              <div className="hidden sm:block">
                <span className="font-bold text-sm tracking-tight text-theme-heading block">
                  Citizen Emergency Portal
                </span>
                <span className="text-[11px] text-gray-500 block">Jodhpur Civic Safety</span>
              </div>
            </div>

            <nav className="flex items-center space-x-1 sm:space-x-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-theme-bg-secondary text-theme-heading font-semibold border border-theme-border'
                          : 'text-gray-600 hover:text-theme-heading hover:bg-theme-bg'
                      }`
                    }
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center space-x-3">
            <div className="hidden md:flex items-center space-x-2 text-xs text-gray-600 pl-3 border-l border-theme-border">
              <User className="w-4 h-4 text-theme-primary" />
              <span className="font-medium">{user?.name || 'Citizen'}</span>
              <Badge size="sm" variant="accent">CITIZEN</Badge>
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
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6">
        <Outlet />
      </main>

      <footer className="py-4 text-center text-xs text-gray-500 border-t border-theme-border/60 bg-white">
        Emergency Response & Resource Allocation System · Citizen Intake Subsystem
      </footer>
    </div>
  );
}

export default CitizenLayout;

