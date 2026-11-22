import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.js';
import Card from '../../components/ui/Card.jsx';
import Input from '../../components/ui/Input.jsx';
import Button from '../../components/ui/Button.jsx';
import { User, Mail, Lock, Shield, ArrowRight, Eye, EyeOff } from 'lucide-react';

const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function RegisterPage() {
  const { register, isLoading, isAuthenticated, role } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');
  const [apiError, setApiError] = useState('');

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
    setNameError('');
    setEmailError('');
    setPasswordError('');
    setConfirmPasswordError('');
    setApiError('');

    const cleanName = name.trim();
    if (!cleanName) {
      setNameError('Full name is required');
      isValid = false;
    } else if (cleanName.length < 2) {
      setNameError('Name must be at least 2 characters long');
      isValid = false;
    } else if (cleanName.length > 100) {
      setNameError('Name cannot exceed 100 characters');
      isValid = false;
    }

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
    } else if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters long');
      isValid = false;
    } else if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      setPasswordError('Password must contain at least one letter and one number');
      isValid = false;
    }

    if (!confirmPassword) {
      setConfirmPasswordError('Please confirm your password');
      isValid = false;
    } else if (password !== confirmPassword) {
      setConfirmPasswordError('Passwords do not match');
      isValid = false;
    }

    return isValid;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm() || isLoading) return;

    try {
      await register(name.trim(), email.trim().toLowerCase(), password);

      // Backend registration returns HTTP 201 with created user and no token.
      // Redirect to login page with pre-filled email and success message.
      navigate('/login', {
        replace: true,
        state: {
          message: 'Citizen account registered successfully! Please sign in with your credentials.',
          email: email.trim().toLowerCase(),
        },
      });
    } catch (err) {
      if (err.code === 'DUPLICATE_EMAIL' || err.status === 409) {
        setApiError('This email address is already registered. Please sign in or use another email.');
      } else if (err.code === 'WEAK_PASSWORD') {
        setPasswordError('Password must be at least 8 characters long and contain at least one letter and one number');
      } else if (err.code === 'DATABASE_UNAVAILABLE') {
        setApiError('Registration is temporarily unavailable (Database disconnected). Please try again later.');
      } else if (err.code === 'NETWORK_ERROR' || err.status === 0) {
        setApiError('Unable to connect to emergency server. Verify the backend service is running on port 5000.');
      } else {
        setApiError(err.message || 'Registration failed. Please check your inputs and try again.');
      }
    }
  };

  return (
    <div className="w-full max-w-md">
      <Card className="shadow-md">
        <div className="p-6 text-center border-b border-theme-border/70 bg-gradient-to-b from-theme-bg to-white">
          <div className="inline-flex p-3 bg-theme-sidebar text-white rounded-xl shadow-xs mb-3">
            <Shield className="w-6 h-6 text-theme-secondary" />
          </div>
          <h2 className="text-lg font-bold text-theme-heading">Citizen Registration</h2>
          <p className="text-xs text-gray-500 mt-1">
            Create an emergency reporting account for Jodhpur Urban Service Area
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4" noValidate>
          {apiError && (
            <div
              role="alert"
              className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg font-medium leading-relaxed"
            >
              {apiError}
            </div>
          )}

          <Input
            id="name"
            name="name"
            autoComplete="name"
            label="Full Name"
            type="text"
            required
            icon={User}
            placeholder="Sanjay Sharma"
            value={name}
            error={nameError}
            disabled={isLoading}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError('');
            }}
          />

          <Input
            id="email"
            name="email"
            autoComplete="email"
            label="Email Address"
            type="email"
            required
            icon={Mail}
            placeholder="citizen@example.com"
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
            autoComplete="new-password"
            label="Password"
            type={showPassword ? 'text' : 'password'}
            required
            icon={Lock}
            placeholder="Min 8 characters (letters + numbers)"
            helperText="Minimum 8 characters with at least one letter and digit."
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

          <Input
            id="confirmPassword"
            name="confirmPassword"
            autoComplete="new-password"
            label="Confirm Password"
            type={showConfirmPassword ? 'text' : 'password'}
            required
            icon={Lock}
            placeholder="Re-type password"
            value={confirmPassword}
            error={confirmPasswordError}
            disabled={isLoading}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              if (confirmPasswordError) setConfirmPasswordError('');
            }}
            rightElement={
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="text-gray-400 hover:text-gray-600 focus:outline-none p-1 rounded"
                aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
              >
                {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
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
            Create Citizen Account
          </Button>
        </form>

        <div className="p-4 bg-theme-bg/60 border-t border-theme-border text-center text-xs text-gray-500">
          Already registered?{' '}
          <Link to="/login" className="font-semibold text-theme-heading hover:underline">
            Sign in
          </Link>
        </div>
      </Card>
    </div>
  );
}

export default RegisterPage;
