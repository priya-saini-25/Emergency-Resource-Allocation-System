import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import authService from '../services/authService.js';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Start with user as null - NEVER trust role stored in localStorage without backend verification
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      return localStorage.getItem('token') || null;
    }
    return null;
  });
  const [isInitializing, setIsInitializing] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  // Monotonically increasing session counter to discard stale asynchronous requests
  const sessionCounterRef = useRef(0);

  // Initialize session verification on mount
  useEffect(() => {
    let isMounted = true;
    const currentSessionId = ++sessionCounterRef.current;

    async function initializeSession() {
      const storedToken =
        typeof window !== 'undefined' && window.localStorage
          ? localStorage.getItem('token')
          : null;

      // 1. If no token exists, immediately initialize as unauthenticated
      if (!storedToken) {
        if (isMounted && sessionCounterRef.current === currentSessionId) {
          setToken(null);
          setUser(null);
          setIsInitializing(false);
        }
        return;
      }

      // 2. If token exists, verify validity against backend /api/auth/me
      try {
        const verifiedUser = await authService.getMe();
        if (isMounted && sessionCounterRef.current === currentSessionId) {
          setUser(verifiedUser);
          setToken(storedToken);
        }
      } catch (err) {
        // Token is invalid, expired, or user deleted -> clear local credentials
        if (isMounted && sessionCounterRef.current === currentSessionId) {
          setToken(null);
          setUser(null);
          if (typeof window !== 'undefined' && window.localStorage) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
          }
        }
      } finally {
        if (isMounted && sessionCounterRef.current === currentSessionId) {
          setIsInitializing(false);
        }
      }
    }

    initializeSession();

    // Listen for global 401 unauthorized events dispatched by apiClient response interceptor
    const handleUnauthorized = () => {
      sessionCounterRef.current++; // Invalidate any pending requests
      setUser(null);
      setToken(null);
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('auth:unauthorized', handleUnauthorized);
    }

    return () => {
      isMounted = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener('auth:unauthorized', handleUnauthorized);
      }
    };
  }, []);

  /**
   * Log in user with credentials and store backend-verified JWT.
   */
  const login = useCallback(async (email, password) => {
    setIsLoading(true);
    const loginSessionId = ++sessionCounterRef.current;

    try {
      const data = await authService.login(email, password);

      // Guard against stale async resolution if logout occurred while login was in-flight
      if (sessionCounterRef.current === loginSessionId) {
        setToken(data.token);
        setUser(data.user);
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem('token', data.token);
        }
      }
      return data.user;
    } finally {
      if (sessionCounterRef.current === loginSessionId) {
        setIsLoading(false);
      }
    }
  }, []);

  /**
   * Register a new citizen account.
   * Note: Backend returns { user } with CITIZEN role, requiring subsequent sign-in.
   */
  const register = useCallback(async (name, email, password) => {
    setIsLoading(true);
    const regSessionId = ++sessionCounterRef.current;

    try {
      const data = await authService.register(name, email, password);
      return data.user;
    } finally {
      if (sessionCounterRef.current === regSessionId) {
        setIsLoading(false);
      }
    }
  }, []);

  /**
   * Log out active user and purge persisted credentials.
   */
  const logout = useCallback(() => {
    sessionCounterRef.current++; // Invalidate all pending asynchronous requests
    setUser(null);
    setToken(null);
    setIsLoading(false);
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
  }, []);

  /**
   * Re-verify current session and fetch latest user profile from backend.
   */
  const refreshUser = useCallback(async () => {
    if (!token) return null;
    const refreshSessionId = ++sessionCounterRef.current;
    setIsLoading(true);

    try {
      const refreshed = await authService.getMe();
      if (sessionCounterRef.current === refreshSessionId) {
        setUser(refreshed);
      }
      return refreshed;
    } catch (err) {
      if (sessionCounterRef.current === refreshSessionId) {
        logout();
      }
      throw err;
    } finally {
      if (sessionCounterRef.current === refreshSessionId) {
        setIsLoading(false);
      }
    }
  }, [token, logout]);

  const value = {
    user,
    token,
    role: user?.role || null,
    isAuthenticated: Boolean(token && user),
    isInitializing,
    isLoading,
    isCitizen: user?.role === 'CITIZEN',
    isControlRoom: user?.role === 'OPERATOR' || user?.role === 'ADMIN',
    isAdmin: user?.role === 'ADMIN',
    login,
    register,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
