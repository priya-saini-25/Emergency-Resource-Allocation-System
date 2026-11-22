# Emergency Resource Allocation & Response Management System
## Frontend-to-Backend Integration Guide (Phase 5 Developer Manual)

> [!NOTE]
> **ACADEMIC SIMULATION & DECISION-SUPPORT PROXY DISCLAIMER**  
> This software is an academic engineering simulation and decision-support prototype developed exclusively for educational and research evaluation within the Jodhpur Urban Service Area (Rajasthan, India). It is not affiliated with, certified by, or connected to real-world emergency dispatch services, public safety answering points (PSAP), fire services, police dispatch, or actual hospital bed management authorities. Do not utilize for life-safety critical operations.

---

## 1. Overview & Architecture

This guide serves as the definitive reference for the React + Vite frontend engineering team (Phase 5) integrating with the hardened Node.js/Express REST backend.

```
+-----------------------------------------------------------------------------------+
|                           REACT + VITE FRONTEND (PORT 5173)                       |
|  - Citizen Intake Form   - Control Room Incident Grid   - Dispatch Confirmation   |
+-----------------------------------------------------------------------------------+
                                         │
                   HTTP/JSON REST API    │  CORS: Origin, Authorization,
                                         │        Idempotency-Key
                                         ▼
+-----------------------------------------------------------------------------------+
|                         NODE.JS / EXPRESS BACKEND (PORT 5000)                     |
|  - Auth & RBAC (JWT)     - Spatial Boundary Snapping     - State Invariant Engine |
|  - Transaction Manager   - Graceful Degradation Guard   - Error Standardizer      |
+-----------------------------------------------------------------------------------+
             │                                                  │
             ▼                                                  ▼
+--------------------------+                      +---------------------------------+
|   MONGODB PERSISTENCE    |                      |      C++ DECISION ENGINE        |
|  - Users, Incidents      |                      |  - Multi-target Dijkstra        |
|  - Resources, Hospitals  |                      |  - Resource & Bed Optimization  |
|  - Dispatch Audit Log    |                      |  - Subprocess JSON Protocol 1.0 |
+--------------------------+                      +---------------------------------+
```

---

## 2. Environment Configuration

The backend is configured via environment variables located in `server/.env`.

### 2.1 Backend Port & Host
- Base URL: `http://localhost:5000`
- API Prefix: `/api`
- Complete API Base: `http://localhost:5000/api`

### 2.2 Vite Client Proxy Configuration
In `vite.config.js`, configure the dev-server proxy to avoid CORS issues entirely during local development:
```javascript
// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false
      }
    }
  }
});
```

---

## 3. Standardized API Response Contracts

The frontend HTTP client (e.g. Axios or native `fetch`) should be typed to handle standardized response envelopes.

### 3.1 Success Envelope Schema
```typescript
interface ApiResponse<T> {
  success: true;
  message: string;
  data: T;
}
```

### 3.2 Error Envelope Schema
```typescript
interface ApiError {
  success: false;
  message: string;
  error: {
    status: number;
    code: string;
    message: string;
    details?: any;
    timestamp: string;
  };
}
```

### 3.3 Recommended Axios Interceptor Setup
```typescript
import axios, { AxiosError } from 'axios';

export const apiClient = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json'
  },
  timeout: 15000 // Accommodates C++ engine 10s subprocess timeout ceiling
});

// Request Interceptor: Attach JWT Token
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response Interceptor: Global Error Normalizer
apiClient.interceptors.response.use(
  (response) => response.data,
  (error: AxiosError<ApiError>) => {
    if (error.response?.data?.error) {
      const { code, message } = error.response.data.error;
      if (code === 'TOKEN_EXPIRED' || code === 'UNAUTHORIZED' || code === 'ACCOUNT_INACTIVE') {
        localStorage.removeItem('auth_token');
        window.location.href = '/login?expired=true';
      }
      return Promise.reject(new Error(message || error.response.data.message));
    }
    return Promise.reject(new Error(error.message || 'Network communication failure'));
  }
);
```

---

## 4. Authentication & Authorization Patterns

### 4.1 Role Hierarchy & Permissions
| Role | Capabilities | Permitted Endpoints |
|---|---|---|
| `CITIZEN` | Submit emergency reports, view own reported incidents. | `POST /api/incidents`, `GET /api/incidents/my`, `GET /api/incidents/:id` (own only). |
| `OPERATOR` | Control-room incident verification, dispatch generation, atomic mobilization, scene tracking, incident resolution. | All incident & dispatch endpoints. |
| `ADMIN` | System supervision, full operator permissions, audit history oversight. | All endpoints. |

### 4.2 Handling Account Deactivation
If an operator account is deactivated (`isActive: false`), the backend returns HTTP 401 with `ACCOUNT_INACTIVE` or `ACCOUNT_DEACTIVATED`. Frontend applications must detect this code and flush any cached tokens.

---

## 5. End-to-End Operational Lifecycle Workflow

The following sequence details how frontend views should orchestrate multi-step emergency response workflows.

```
 [ Citizen App ]           [ Control Room View ]         [ Dispatch Confirmation ]      [ Incident Tracker ]
        │                            │                              │                            │
 1. POST /api/incidents              │                              │                            │
   (Status: REPORTED)                │                              │                            │
        │                            │                              │                            │
        └───────────────────────────►│                              │                            │
                             2. PATCH /api/incidents/:id/verify     │                            │
                               (Status: VERIFIED)                   │                            │
                                     │                              │                            │
                             3. POST /api/dispatch/recommendations  │                            │
                               (Invokes C++ Decision Engine)        │                            │
                                     │                              │                            │
                                     └─────────────────────────────►│                            │
                                                            4. POST /api/dispatch/rec/:id/confirm │
                                                              (Idempotency-Key Header)   │
                                                              (Status: DISPATCHED)       │
                                                                    │                    │
                                                                    └───────────────────►│
                                                                                 5. PATCH /api/incidents/:id/arrive
                                                                                   (Status: ON_SCENE)
                                                                                         │
                                                                                 6. PATCH /api/incidents/:id/resolve
                                                                                   (Status: RESOLVED)
                                                                                   (Restores Bed Capacity)
```

### Step 1: Citizen Incident Intake
- Submit incident coordinates within Jodhpur boundary.
- If coordinates fall outside the polygon, backend returns `400 OUTSIDE_SERVICE_AREA`. The frontend map should show a polygon overlay restricting marker placement.

### Step 2: Control Room Verification
- Control room operator reviews the live incoming feed (`GET /api/incidents?status=REPORTED`).
- Operator clicks "Verify Incident", sending `PATCH /api/incidents/:incidentId/verify` with optional notes.
- Concurrency Safe: If another operator verifies or rejects simultaneously, the backend returns `409 INCIDENT_STATE_CONFLICT`.

### Step 3: Recommendation Generation
- Operator selects one or more verified incidents and requests dispatch recommendations: `POST /api/dispatch/recommendations`.
- The Node backend calls the C++ engine, which calculates optimal Dijkstra routes, selects nearest capable fire/ambulance/police units, and matches nearest hospital with available beds.
- Returns a persistent recommendation batch (`batchId`).

### Step 4: Atomic Dispatch Confirmation with Idempotency
- When operator clicks "Confirm & Mobilize", the client MUST generate a unique `Idempotency-Key` (e.g. `crypto.randomUUID()`) and send `POST /api/dispatch/recommendations/:batchId/confirm`.
- If a network glitch occurs and the request is retried, the backend detects the duplicate `Idempotency-Key` and safely returns HTTP 200 with the already-confirmed dispatch record, preventing double unit dispatch or duplicate hospital bed reservations.

### Step 5: Scene Arrival Tracking
- When first responders arrive on site, the operator clicks "Mark Arrived", sending `PATCH /api/incidents/:incidentId/arrive`.
- Status updates from `DISPATCHED` to `ON_SCENE`. Direct transition from `VERIFIED` to `ON_SCENE` is strictly prohibited.

### Step 6: Incident Resolution & Resource De-allocation
- When emergency operations conclude, operator clicks "Resolve Incident", sending `PATCH /api/incidents/:incidentId/resolve`.
- Status updates from `ON_SCENE` to `RESOLVED`.
- Backend atomically marks assigned vehicles back to `AVAILABLE` and restores reserved hospital beds.

---

## 6. Real-time Polling & Refresh Guidelines

For Phase 5, control room dashboards should poll operational endpoints with the following recommended intervals:

| Screen / Component | Endpoint | Polling Interval | Cache Policy |
|---|---|---|---|
| Incoming Incident Feed | `GET /api/incidents?status=REPORTED` | 3,000 ms – 5,000 ms | No cache (`Cache-Control: no-cache`) |
| Active Incident Operations | `GET /api/incidents/active` | 3,000 ms – 5,000 ms | No cache |
| Citizen My Incidents | `GET /api/incidents/my` | 10,000 ms | Cache 5s |
| Health Indicator Widget | `GET /api/health` | 30,000 ms | Stale-while-revalidate |

---

## 7. Error Handling & Edge Cases

| Scenario | HTTP Status | Frontend Remediation / UI Behavior |
|---|---|---|
| Database Disconnected | `503` | Display global yellow banner: "System running in degraded mode. Persisted updates unavailable." |
| Engine Timeout | `504` | Display alert: "Routing engine calculation took too long. Retry with fewer selected incidents." |
| Standalone Mongo (No Transactions) | `503 TRANSACTION_UNAVAILABLE` | Alert administrator to configure MongoDB replica set (`--replSet rs0`). |
| Incident Conflict | `409` | Refresh current incident state; notify operator that another user modified the incident. |

