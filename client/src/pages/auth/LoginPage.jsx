import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.js';
import Card from '../../components/ui/Card.jsx';
import Input from '../../components/ui/Input.jsx';
import Button from '../../components/ui/Button.jsx';
import { Mail, Lock, Shield, ArrowRight, UserCheck, Eye, EyeOff, CheckCircle } from 'lucide-react';

const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function LoginPage() {
  const { login, isLoading, isAuthenticated, role } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [apiError, setApiError] = useState('');
  const [successNotice, setSuccessNotice] = useState('');

  const from = location.state?.from?.pathname || null;

  // Display notice if redirected from registration
  useEffect(() => {
    if (location.state?.message) {
      setSuccessNotice(location.state.message);
    }
    if (location.state?.email) {
      setEmail(location.state.email);
    }
  }, [location.state]);

  // If already authenticated, redirect to authorized dashboard
  useEffect(() => {
    if (isAuthenticated && role) {
      if (role === 'CITIZEN') {
        navigate('/citizen/dashboard', { replace: true });
      } else {
        navigate('/control-room/dashboard', { replace: true });
      }
    }
  }, [isAuthenticated, role, navigate]);

  const validateForm = () => {
    let isValid = true;
    setEmailError('');
    setPasswordError('');
    setApiError('');

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setEmailError('Email address is required');
      isValid = false;
    } else if (!emailRegex.test(cleanEmail)) {
      setEmailError('Please enter a valid email address');
      isValid = false;
    }

    if (!password) {
      setPasswordError('Password is required');
      isValid = false;
    }

    return isValid;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm() || isLoading) return;

    try {
      const verifiedUser = await login(email.trim(), password);

      // Handle role-aware redirection
      if (from) {
        navigate(from, { replace: true });
      } else if (verifiedUser.role === 'CITIZEN') {
        navigate('/citizen/dashboard', { replace: true });
      } else {
        // OPERATOR and ADMIN go to the Control Room Dashboard
        navigate('/control-room/dashboard', { replace: true });
      }
    } catch (err) {
      if (err.code === 'INVALID_CREDENTIALS') {
        setApiError('Invalid email or password. Please verify your credentials.');
      } else if (err.code === 'ACCOUNT_DEACTIVATED') {
        setApiError('This account has been deactivated. Please contact the control room administrator.');
      } else if (err.code === 'DATABASE_UNAVAILABLE') {
        setApiError('Authentication is temporarily unavailable (Database disconnected). Operating in degraded mode.');
      } else if (err.code === 'NETWORK_ERROR' || err.status === 0) {
        setApiError('Unable to connect to emergency server. Verify the backend service is running on port 5000.');
      } else {
        setApiError(err.message || 'Authentication failed. Please try again.');
      }
    }
  };

  const handlePreFillOperator = () => {
    setEmail('operator@jodhpur.emergency.gov.in');
    setPassword('');
    setEmailError('');
    setPasswordError('');
    setApiError('');
    setSuccessNotice('Operator email populated. Enter your configured control-room password to sign in.');
  };

  return (
    <div className="w-full max-w-md">
      <Card className="shadow-md">
        <div className="p-6 text-center border-b border-theme-border/70 bg-gradient-to-b from-theme-bg to-white">
          <div className="inline-flex p-3 bg-theme-sidebar text-white rounded-xl shadow-xs mb-3">
            <Shield className="w-6 h-6 text-theme-secondary" />
          </div>
          <h2 className="text-lg font-bold text-theme-heading">Emergency Dispatch System</h2>
          <p className="text-xs text-gray-500 mt-1">
            Sign in to access emergency reporting or control-room operations
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4" noValidate>
          {successNotice && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg font-medium flex items-center space-x-2">
              <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>{successNotice}</span>
            </div>
          )}

          {apiError && (
            <div
              role="alert"
              className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg font-medium leading-relaxed"
            >
              {apiError}
            </div>
          )}

          <Input
            id="email"
            name="email"
            autoComplete="username"
            label="Email Address"
            type="email"
            required
            icon={Mail}
            placeholder="officer@jodhpur.emergency.gov.in"
            value={email}
            error={emailError}
            disabled={isLoading}
            onChange={(e) => {
              setEmail(e.target.value);
              if (emailError) setEmailError('');
            }}
          />

          <Input
            id="password"
            name="password"
            autoComplete="current-password"
            label="Password"
            type={showPassword ? 'text' : 'password'}
            required
            icon={Lock}
            placeholder="••••••••••••"
            value={password}
            error={passwordError}
            disabled={isLoading}
            onChange={(e) => {
              setPassword(e.target.value);
              if (passwordError) setPasswordError('');
            }}
            rightElement={
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-gray-400 hover:text-gray-600 focus:outline-none p-1 rounded"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            }
          />

          <Button
            type="submit"
            variant="primary"
            className="w-full mt-2"
            loading={isLoading}
            disabled={isLoading}
            icon={ArrowRight}
            iconPosition="right"
          >
            Authenticate & Proceed
          </Button>

          {/* Quick Access Helper */}
          <div className="pt-4 border-t border-theme-border/60">
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-2 text-center">
              Simulation Preset (Control Room)
            </span>
            <div className="flex flex-col space-y-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={UserCheck}
                disabled={isLoading}
                onClick={handlePreFillOperator}
                className="w-full text-xs"
              >
                Populate Control Room Operator Email
              </Button>
            </div>
            <p className="text-[10px] text-gray-500 text-center mt-2 leading-relaxed">
              Fills <code className="text-theme-heading font-medium">operator@jodhpur.emergency.gov.in</code> into the email field. Enter your configured password to sign in.
            </p>
          </div>
        </form>

        <div className="p-4 bg-theme-bg/60 border-t border-theme-border text-center text-xs text-gray-500">
          Citizen reporting an emergency?{' '}
          <Link to="/register" className="font-semibold text-theme-heading hover:underline">
            Register a citizen account
          </Link>
          {' '}to submit and track incident reports.
        </div>
      </Card>
    </div>
  );
}

export default LoginPage;
