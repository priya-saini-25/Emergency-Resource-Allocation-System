# Phase 8.4 — Real-Time In-App Popup Notification System Report

**Project:** Emergency Resource Allocation & Response Management System (Jodhpur Urban Service Area Simulation)  
**Date:** November 22, 2026  
**Status:** COMPLETE & VERIFIED  
**Phase:** 8.4 — Real-Time In-App Popup Notification System  
**Auditor / Engineer:** Antigravity AI  

---

## 1. Executive Summary

Phase 8.4 introduces a centralized, in-app real-time notification and alert infrastructure for the Emergency Resource Allocation System. 

### Key Objectives Achieved:
1. **Zero Email Policy Enforced:** Completely avoided email notifications, SMTP dependencies, Nodemailer, and email credentials. All notifications are strictly delivered within the web application.
2. **Real-Time Operator Emergency Popups:** Upon citizen submission of an emergency report, the incident is persisted to MongoDB, and an authenticated real-time Server-Sent Events (SSE) notification is broadcast immediately to all connected `OPERATOR` and `ADMIN` users without requiring a page refresh.
3. **Privacy & Sanitization:** Real-time alert payloads exclude reporter personal phone numbers (`reporterPhone`, `alternatePhone`, `callerContact`) and personal credentials.
4. **Centralized In-App Toast System:** Built a unified toast provider supporting 4 canonical types (`SUCCESS`, `ERROR`, `WARNING`, `INFO`) with auto-dismissal, manual close, and automated 3-second de-duplication to prevent duplicate popups.
5. **System-Wide Action Messages:** Integrated exact required operational status messages across all critical lifecycle stages (reporting, verification, rejection, C++ recommendation, dispatch confirmation, resource arrival, hospital assignment, resolution, and fleet release).

---

## 2. Notification Architecture & Real-Time Delivery

```
                       +-----------------------------------+
                       |   Citizen Portal / REST Client    |
                       +-----------------------------------+
                                         │
                                         │ POST /api/incidents
                                         ▼
                       +-----------------------------------+
                       |    Incident Controller (Backend)  |
                       | - Validates boundary & input      |
                       | - Persists to MongoDB Incident    |
                       +-----------------------------------+
                                         │
                                         ▼
                       +-----------------------------------+
                       | RealtimeNotificationService (SSE) |
                       | emitControlRoomNotification()     |
                       +-----------------------------------+
                                         │
            ┌────────────────────────────┴────────────────────────────┐
            │ GET /api/notifications/stream?token=<JWT>                │
            ▼                                                         ▼
+───────────────────────────────+         +───────────────────────────────+
| Control Room Operator Browser |         | Control Room Operator Browser |
| (Session 1: Dashboard)        |         | (Session 2: Active Ops)       |
|                               |         |                               |
| - EventSource SSE Client      |         | - EventSource SSE Client      |
| - NotificationContext         |         | - NotificationContext         |
| - OperatorEmergencyPopup.jsx  |         | - OperatorEmergencyPopup.jsx  |
| - ToastContainer.jsx          |         | - ToastContainer.jsx          |
+───────────────────────────────+         +───────────────────────────────+
```

### Real-Time Delivery Mechanism: Server-Sent Events (SSE)
- **Endpoint:** `GET /api/notifications/stream`
- **Protocol:** HTTP/1.1 SSE (`Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`).
- **Heartbeat:** Automated 25-second ping (`: heartbeat\n\n`) maintains persistent connection through proxies without socket timeouts.
- **Authentication:** Dual Bearer support:
  1. Standard HTTP header: `Authorization: Bearer <token>`
  2. Browser EventSource query param: `?token=<token>`
- **Authorization:** Restricted to `OPERATOR` and `ADMIN` roles. Unauthenticated connections return `401 Unauthorized`; `CITIZEN` connections return `403 Forbidden`.
- **Client Management:** Connections are tracked in an in-memory registry with automatic cleanup upon socket disconnection (`res.on('close')`).

---

## 3. Canonical Action Messages & UI Implementation

| Lifecycle Action | Toast Type | Canonical Popup Message | Integrated Component |
| :--- | :---: | :--- | :--- |
| **Emergency report submitted** | `SUCCESS` | `Emergency report submitted successfully.` | `CitizenReportEmergency.jsx` |
| **New report received by operator** | `INFO` | `New emergency report received.` | `NotificationContext.jsx` (SSE) |
| **Incident verified** | `SUCCESS` | `Incident verified successfully.` | `ControlRoomIncidentDetailPage.jsx` |
| **Incident rejected** | `WARNING` | `Emergency report rejected.` | `ControlRoomIncidentDetailPage.jsx` |
| **Dispatch recommendation generated** | `INFO` | `Resource allocation recommendation generated.` | `DispatchPlannerPage.jsx` |
| **Resources allocated** | `SUCCESS` | `Resources allocated successfully.` | `DispatchPlannerPage.jsx` |
| **Dispatch confirmed** | `SUCCESS` | `Dispatch confirmed successfully.` | `DispatchPlannerPage.jsx` |
| **First resource arrives** | `INFO` | `First response resource has arrived.` | `ActiveOperationsPage.jsx` |
| **Partial resource arrival** | `INFO` | `X of Y resources have arrived.` | `ActiveOperationsPage.jsx` |
| **All resources arrive** | `SUCCESS` | `All assigned resources have arrived.` | `ActiveOperationsPage.jsx` |
| **Hospital assigned** | `INFO` | `Hospital assigned successfully.` | `DispatchPlannerPage.jsx` |
| **Incident resolved** | `SUCCESS` | `Incident resolved successfully.` | `ActiveOperationsPage.jsx` |
| **Resources released** | `INFO` | `Resources are now available for new incidents.` | `ActiveOperationsPage.jsx` |
| **Operation fails** | `ERROR` | `[Meaningful error message from API or validation]` | All catch blocks across UI |

### UI Components Built:
1. **`ToastContainer.jsx`:** Fixed top-right container rendering toasts with Slate x Ice Blue tokens, progress auto-dismiss (5 seconds), and manual close buttons.
2. **`OperatorEmergencyPopup.jsx`:** Fixed bottom-right high-visibility card with pulsing emergency ping, Incident ID badge, category, severity tier, location details, submission timestamp, and one-click `"Open Incident"` action.

---

## 4. Files Created & Modified

### Backend:
- `server/src/services/realtimeNotificationService.js` *(NEW)*: Manages active SSE connections, heartbeat keep-alive, client cleanup, and control-room broadcasting.
- `server/src/controllers/notificationController.js` *(NEW)*: Controller handling `streamNotifications` endpoint with role verification.
- `server/src/routes/notificationRoutes.js` *(NEW)*: Express router mounting `GET /api/notifications/stream`.
- `server/src/middleware/auth.js` *(MODIFIED)*: Added query parameter token support (`?token=...`) for native browser `EventSource` authentication.
- `server/src/controllers/incidentController.js` *(MODIFIED)*: Broadcasts sanitized `NEW_EMERGENCY_REPORT` event immediately after persisting incident to MongoDB.
- `server/src/app.js` *(MODIFIED)*: Mounted `/api/notifications` route.
- `server/tests/realtimeNotification.test.js` *(NEW)*: 9 backend unit & integration tests.

### Frontend:
- `client/src/utils/notificationConstants.js` *(NEW)*: Defines `TOAST_TYPES`, `DEFAULT_TOAST_DURATION`, and `DEDUPE_WINDOW_MS`.
- `client/src/context/NotificationContext.jsx` *(NEW)*: React context managing toast queues, deduplication, auto-dismissal, and browser SSE connection lifecycle.
- `client/src/components/ui/ToastContainer.jsx` *(NEW)*: Floating toast notifications component.
- `client/src/components/ui/OperatorEmergencyPopup.jsx` *(NEW)*: Urgent emergency alert card for incoming citizen reports.
- `client/src/App.jsx` *(MODIFIED)*: Wrapped with `NotificationProvider` and mounted `ToastContainer` and `OperatorEmergencyPopup`.
- `client/src/pages/citizen/CitizenReportEmergency.jsx` *(MODIFIED)*: Added submission success & failure toasts.
- `client/src/pages/control-room/ControlRoomIncidentDetailPage.jsx` *(MODIFIED)*: Added verification and rejection toasts.
- `client/src/pages/control-room/DispatchPlannerPage.jsx` *(MODIFIED)*: Added C++ recommendation generation, resource allocation, dispatch confirmation, and hospital assignment toasts.
- `client/src/pages/control-room/ActiveOperationsPage.jsx` *(MODIFIED)*: Added milestone arrival tracking toasts (first, partial, all) and resolution/release toasts.
- `client/tests/notificationSystem.test.js` *(NEW)*: 10 frontend unit & state tests.

---

## 5. Automated Test Evidence & Regression Safety

### A. Dedicated Backend Tests
File: `server/tests/realtimeNotification.test.js`  
Command: `node --test server/tests/realtimeNotification.test.js`  
**Result:** **9 / 9 passed (0 failures, 29.2ms)**
- Text/event-stream headers and CONNECTED handshake verified.
- Event broadcasting restricted to OPERATOR and ADMIN verified.
- Sanitization: verified no phone numbers or personal information leaked in SSE payload.
- Disconnect client cleanup verified.
- 401 Unauthorized for unauthenticated streams verified.
- 403 Forbidden for CITIZEN streams verified.
- Bearer header authentication verified.
- Query param token (`?token=...`) authentication verified.
- Citizen incident creation triggering operator SSE broadcast verified.

### B. Full Backend Regression
Command: `npm --prefix server test`  
**Result:** **303 / 303 passed (0 failures, 88 test suites, 23.5s)**

### C. Dedicated Frontend Tests
File: `client/tests/notificationSystem.test.js`  
Command: `node --test client/tests/notificationSystem.test.js`  
**Result:** **10 / 10 passed (0 failures, 15.9ms)**
- Canonical toast types (SUCCESS, ERROR, WARNING, INFO) verified.
- Creation, timeout auto-dismiss, and manual dismissal verified.
- Rapid deduplication suppression verified.
- Operator emergency popup structure, fields, and privacy verified.
- System-wide action messages verified against canonical table.
- Failed operations displaying error notifications (not success) verified.
- Role-based stream authorization rules verified.

### D. Full Frontend Regression
Command: `npm --prefix client test`  
**Result:** **154 / 154 passed (0 failures, 63 test suites, 1.54s)**

### E. Frontend Production Build
Command: `npm --prefix client run build`  
**Result:** **SUCCESS (0 errors, built in 15.07s)**

---

## 6. Live Browser Verification & Acceptance Scenario

A complete end-to-end acceptance test was executed in real browser sessions on `http://localhost:3001` with an active backend at `http://localhost:5001`.

### Step 1: Authentication & Operator Landing
- **User:** `operator@jodhpur.emergency.gov.in` (Role: `OPERATOR`)
- **Landing URL:** `/control-room/dashboard`
- **Verification:** Authenticated and landed directly on the Control Room Dashboard with `NotificationProvider` mounted and the real-time notification stream (`GET /api/notifications/stream?token=...`) established.

### Step 2: Citizen Emergency Incident Submission
- **Account:** Registered citizen `Paota Resident` (`citizen_paota@test.com`) in an isolated browser context.
- **Incident Category:** `FIRE` (Structure / Vehicle Fire)
- **Reported Severity:** Level 4 (High Urgency)
- **Coordinates:** `26.29780° N, 73.01850° E` (Paota / Jodhpur Urban Service Area)
- **Situation Description:** `"Smoke visible from Paota Depot"`
- **Reporter Phone:** `+91 9876543210`
- **Result:** Incident successfully registered in database with ID: **`#17953325847934`**.
- **Observed Citizen Toast:** `"Emergency report submitted successfully."`

### Step 3: Real-Time Emergency Popup on Operator Dashboard (Zero Page Reload)
- **Observation:** Immediately upon submission on the citizen portal, the operator dashboard view received the SSE broadcast and rendered an intrusive, high-visibility live popup notification in the lower right viewport without any page reload.
- **Observed Popup Content:**
  - Header: `"NEW EMERGENCY REPORT"` with pulsing alert beacon
  - Incident ID: `#17953325847934`
  - Priority & Severity: `P4 · SEV 4`
  - Category: `FIRE`
  - Location: `Paota / Jodhpur Urban Area`
  - Timestamp: `12:59:44 PM`
  - Privacy Check: Reporter personal phone number was strictly excluded.
  - Action Buttons: `[Dismiss]` and `[Open Incident]`
- **Screenshot:** `docs/screenshots/phase_8_4_operator_realtime_popup.png`

### Step 4: Popup Navigation & Incident Verification
- **Action:** Clicked `Open Incident` directly on the real-time popup.
- **Navigation:** Routed seamlessly to `/control-room/incidents/17953325847934`.
- **Verification Action:** Opened verification modal and confirmed incident (`CONFIRMED`).
- **Observed Toast Notification:** `"Incident verified successfully."`
- **Status Transition:** Changed from `REPORTED` to `VERIFIED`.
- **Screenshot:** `docs/screenshots/phase_8_4_incident_verified_toast.png`

### Step 5: Dispatch Planner & C++ Engine Optimization
- **Navigation:** `/control-room/dispatch`
- **Selection:** Incident `#17953325847934`
- **Action:** Clicked `"Run C++ Optimization (1)"`
- **Observed Optimization Toasts:**
  1. `"Resource allocation recommendation generated."`
  2. `"Resources allocated successfully."`
- **C++ Engine Output:** Batch ID `BATCH-1795332697602-b3cf1fe2` (Units: Fire Tender 501, BLS Ambulance 302, Fire Engine 304; Hospital: MDM Hospital Jodhpur).
- **Confirmation Action:** Clicked `"Confirm & Mobilize Fleet"` -> `"Confirm Dispatch"`.
- **Observed Confirmation Toasts:**
  1. `"Dispatch confirmed successfully."`
  2. `"Hospital assigned successfully."`
- **Screenshot:** `docs/screenshots/phase_8_4_dispatch_confirmed_toasts.png`

### Step 6: Active Field Operations & Lifecycle Resolution
- **Navigation:** `/control-room/active-incidents`
- **Arrival Action:** Clicked `"Mark Arrived"` for incident `#17953325847934` and confirmed arrival for all units.
- **Observed Arrival Toast:** `"All assigned resources have arrived."`
- **Resolution Action:** Clicked `"Resolve Incident"` with notes: *"Fire extinguished at Paota Depot. No casualties. All units released."*
- **Observed Resolution Toasts:**
  1. `"Incident resolved successfully."`
  2. `"Resources are now available for new incidents."`
  3. Inline Notification: `"Incident #17953325847934 successfully resolved! 3 unit(s) released to AVAILABLE and 0 hospital reservation(s) restored."`
- **Screenshot:** `docs/screenshots/phase_8_4_incident_resolved_toasts.png`

---

## 7. Strict Constraints & Integrity Confirmation

- **No Email Functionality:** Zero email services, SMTP credentials, or Nodemailer packages added.
- **C++ Engine Untouched:** Optimization algorithms, Dijkstra shortest-path calculations, priority ranking, and capacity release logic were preserved without modification.
- **Academic Simulation Disclaimer:** Retained prominently across all citizen and control room interfaces.
