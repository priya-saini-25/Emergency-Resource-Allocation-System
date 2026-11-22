# Emergency Resource Allocation & Response Management System
## Phase 5.2 — Authentication Integration & Role-Based User Session

> [!NOTE]
> **ACADEMIC SIMULATION & DECISION-SUPPORT PROXY DISCLAIMER**  
> This software is an academic engineering simulation and decision-support prototype developed exclusively for educational and research evaluation within the Jodhpur Urban Service Area (Rajasthan, India). It is not affiliated with, certified by, or connected to real-world emergency dispatch services, public safety answering points (PSAP), fire services, police dispatch, or actual hospital bed management authorities. Do not utilize for life-safety critical operations.

---

## 1. Overview & Objectives

Phase 5.2 completes the real frontend-to-backend authentication and session integration for the Emergency Resource Allocation & Response Management System. The integration binds the React 18 client directly to the Express authentication endpoints implemented in Phase 4.2 / 4.7.

Key capabilities delivered:
1. **Citizen Registration:** Strict client-side validation, duplicate email detection, and automatic post-registration redirect to sign-in.
2. **Multi-Role Login:** Supports `CITIZEN`, `OPERATOR`, and `ADMIN` credentials with backend verification and password visibility controls.
3. **Backend-Verified Session Restoration:** Verifies persisted JWT tokens on application mount using `GET /api/auth/me`. Does not trust unverified roles in client storage.
4. **Role-Based Navigation & Route Guards:** Protected routes (`ProtectedRoute`) and public routes (`PublicOnlyRoute`) enforce strict role segregation (`/citizen/*` vs `/control-room/*`).
5. **Secure Token Persistence & Limitation Disclosure:** Uses `localStorage` for JWT persistence with documented academic limitations.
6. **Graceful Error Handling:** Translates backend domain error codes (`INVALID_CREDENTIALS`, `DUPLICATE_EMAIL`, `ACCOUNT_DEACTIVATED`, `DATABASE_UNAVAILABLE`) into user-friendly messages.

---

## 2. Exact Backend API Contracts Integrated

All requests and responses strictly adhere to the contracts documented in [`docs/API_REFERENCE.md`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/docs/API_REFERENCE.md).

### 2.1 Citizen Registration (`POST /api/auth/register`)
- **Access:** Public
- **Request Headers:** `Content-Type: application/json`
- **Request Payload:**
  ```json
  {
    "name": "Sanjay Sharma",
    "email": "sanjay@example.com",
    "password": "Password123!"
  }
  ```
- **Response `201 Created`:**
  ```json
  {
    "success": true,
    "message": "Citizen account registered successfully",
    "data": {
      "user": {
        "id": "6739f77bcf86cd799439011a",
        "name": "Sanjay Sharma",
        "email": "sanjay@example.com",
        "role": "CITIZEN",
        "isActive": true,
        "createdAt": "2026-11-18T02:00:00.000Z"
      }
    }
  }
  ```
- **Important Architectural Note:** The backend `register` endpoint intentionally does *not* issue a JWT. The frontend workflow redirects the user to `/login` with a pre-filled email and success banner.

### 2.2 User Login (`POST /api/auth/login`)
- **Access:** Public
- **Request Headers:** `Content-Type: application/json`
- **Request Payload:**
  ```json
  {
    "email": "operator@jodhpur.gov.in",
    "password": "OperatorSecure2026!"
  }
  ```
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "message": "Login successful",
    "data": {
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "user": {
        "id": "6739f77bcf86cd799439011b",
        "name": "Control Room Operator 1",
        "email": "operator@jodhpur.gov.in",
        "role": "OPERATOR",
        "isActive": true,
        "lastLoginAt": "2026-11-18T02:30:00.000Z"
      }
    }
  }
  ```

### 2.3 Current Profile Verification (`GET /api/auth/me`)
- **Access:** Authenticated (`CITIZEN`, `OPERATOR`, `ADMIN`)
- **Request Headers:** `Authorization: Bearer <jwt_token>`
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "message": "Current user profile retrieved successfully",
    "data": {
      "user": {
        "id": "6739f77bcf86cd799439011b",
        "name": "Control Room Operator 1",
        "email": "operator@jodhpur.gov.in",
        "role": "OPERATOR",
        "isActive": true
      }
    }
  }
  ```

---

## 3. Authentication State Architecture (`AuthContext.jsx`)

The authentication state model is managed centrally in [AuthContext.jsx](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/context/AuthContext.jsx):

```typescript
interface AuthContextValue {
  user: UserProfile | null;
  token: string | null;
  role: 'CITIZEN' | 'OPERATOR' | 'ADMIN' | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  isLoading: boolean;
  isCitizen: boolean;
  isControlRoom: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<UserProfile>;
  register: (name: string, email: string, password: string) => Promise<UserProfile>;
  logout: () => void;
  refreshUser: () => Promise<UserProfile | null>;
}
```

### 3.1 Security Principles Enforced
1. **No Client Role Trust:** On startup, the `user` state always initializes as `null`. It is populated solely by the verified payload of `GET /api/auth/me` or the backend login response.
2. **Session Initialization Guard:** `isInitializing` begins `true`. While `true`, `ProtectedRoute` and `PublicOnlyRoute` display a loading spinner, preventing any flash of protected or unauthorized content.
3. **Stale Request Discard:** Uses `sessionCounterRef` to discard in-flight asynchronous profile requests if a user logs out before the response arrives.
4. **Auto-Purge on Invalidation:** Listens for global `'auth:unauthorized'` events dispatched by the Axios response interceptor upon receiving HTTP 401 with `TOKEN_EXPIRED`, `UNAUTHORIZED`, or `ACCOUNT_INACTIVE`.

---

## 4. Role-Based Route Policy

```
[ Incoming Navigation ]
           │
           ├─► /login, /register ──► [ PublicOnlyRoute ]
           │                              │
           │                              ├─► If Authenticated: Redirect to Role Dashboard
           │                              └─► If Unauthenticated: Render Auth Form
           │
           ├─► /citizen/* ─────────► [ ProtectedRoute (CITIZEN, ADMIN) ]
           │                              │
           │                              ├─► If Unauthenticated: Redirect to /login
           │                              ├─► If OPERATOR: Redirect to /control-room/dashboard
           │                              └─► If Permitted: Render Citizen View
           │
           └─► /control-room/* ────► [ ProtectedRoute (OPERATOR, ADMIN) ]
                                          │
                                          ├─► If Unauthenticated: Redirect to /login
                                          ├─► If CITIZEN: Redirect to /citizen/dashboard
                                          └─► If Permitted: Render Control Room View
```

---

## 5. Token Persistence Strategy & Limitations

- **Storage Location:** Client-side `localStorage.getItem('token')`.
- **Academic Limitation Disclosure:** `localStorage` provides persistent authentication across page reloads and browser restarts without requiring specialized domain-locked cookie configurations in local development. However, `localStorage` is accessible to client-side JavaScript and vulnerable to Cross-Site Scripting (XSS) attacks. For production medical or public safety systems, session tokens should be transmitted inside `HttpOnly`, `Secure`, `SameSite=Strict` cookies accompanied by CSRF protection tokens.

---

## 6. Verification & Test Evidence

### 6.1 Frontend Integration Unit Tests
```
> emergency-allocation-client@1.0.0 test
> node --test tests/**/*.test.js

▶ Phase 5.2 — Authentication & Role-Based Session Integration Tests
  ✔ AuthService API Contract Alignment (3 tests)
  ✔ Auth State Machine & Session Restoration Logic (4 tests)
  ✔ Form Validation & Security Rules (4 tests)
  ✔ Role-Based Route Navigation & Redirection Policy (4 tests)
✔ Phase 5.2 (15 tests pass)

▶ Phase 5.1 — Frontend Foundation & Design System Verification
  ✔ Slate x Ice Blue Design System Tokens (5 tests)
  ✔ Canonical Jodhpur Geographic Configuration (3 tests)
  ✔ API Client & Service Contract Definitions (4 tests)
✔ Phase 5.1 (12 tests pass)

ℹ tests 27
ℹ suites 9
ℹ pass 27
ℹ fail 0
ℹ duration_ms 444.5591
```

### 6.2 Production Compilation
```
> emergency-allocation-client@1.0.0 build
> vite build

✓ 1728 modules transformed.
dist/index.html                   0.58 kB
dist/assets/index-BnmK0TRI.css   42.94 kB
dist/assets/index-C-r3lCvR.js   482.16 kB
✓ built in 4.67s
```

### 6.3 Backend Regression
`cd server; npm test` confirms all 180 tests across 59 suites pass with 100% success.

