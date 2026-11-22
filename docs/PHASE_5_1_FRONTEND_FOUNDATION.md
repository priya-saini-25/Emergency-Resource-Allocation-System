# Emergency Resource Allocation & Response Management System
## Phase 5.1 — Frontend Foundation & Design System Specification

> [!NOTE]
> **ACADEMIC SIMULATION & DECISION-SUPPORT PROXY DISCLAIMER**  
> This software is an academic engineering simulation and decision-support prototype developed exclusively for educational and research evaluation within the Jodhpur Urban Service Area (Rajasthan, India). It is not affiliated with, certified by, or connected to real-world emergency dispatch services, public safety answering points (PSAP), fire services, police dispatch, or actual hospital bed management authorities. Do not utilize for life-safety critical operations.

---

## 1. Executive Overview

Phase 5.1 establishes the frontend foundation for the Emergency Resource Allocation & Response Management System. Built using React 18, Vite, Tailwind CSS, and React Router v7, the frontend implements the Slate × Ice Blue design system, role-based application layouts, centralized API services, authentication context, and visually complete demonstration dashboard shells for both Citizen and Control Room operator profiles.

---

## 2. Design System Tokens (Slate × Ice Blue)

The design system uses a focused palette with clear visual hierarchy, accessible contrast, and semantic emergency status indicators.

### 2.1 Theme Palette
| Token Name | Hex Value | Tailwind Class | Semantic Application |
|---|---|---|---|
| Main Background | `#F4F6F8` | `bg-theme-bg` | Global page backdrop |
| Dark Slate Sidebar | `#252F3B` | `bg-theme-sidebar` | Control room command sidebar, banner |
| Cards & Containers | `#FFFFFF` | `bg-theme-card` | Elevated card surfaces, dialogs, tables |
| Secondary Background | `#E8EDF2` | `bg-theme-bg-secondary` | Section badges, button hover backgrounds |
| Primary Accent | `#789CB8` | `text-theme-primary` | Navigation accents, primary highlights |
| Secondary Accent | `#B6CAD9` | `text-theme-secondary` | Subtle borders, secondary tags, branding |
| Headings & Primary Text| `#27313D` | `text-theme-heading` | High-contrast typography |
| Borders & Dividers | `#D9E0E7` | `border-theme-border` | Subtle grid lines, card borders |

### 2.2 Operational Emergency Indicators
| Indicator | Hex Value | Semantic Meaning |
|---|---|---|
| Critical (P1) | `#DC4545` | Life-safety critical incident, structural collapse, fire |
| High (P2) | `#E89543` | Major collision, hazardous material incident |
| Medium (P3) | `#D5B34F` | Moderate injury, non-immediate medical condition |
| Available | `#56866B` | Free fleet units, open hospital bed capacity |
| Dispatched | `#5685B5` | Mobilized units en route to incident scene |

---

## 3. Frontend Architecture

```
client/src/
├── assets/                  # Static assets and icons
├── components/
│   ├── common/              # Global shared components
│   │   ├── ProtectedRoute.jsx   # Role-based route guard
│   │   └── SimulationBanner.jsx # Academic disclaimer notice
│   ├── layout/              # Sub-layout elements
│   ├── map/                 # Geospatial components
│   │   └── MapContainer.jsx     # Leaflet map container (OSM tiles)
│   └── ui/                  # Design system atomic components
│       ├── Badge.jsx            # Status & role pill badge
│       ├── Button.jsx           # Styled button with variants & loading states
│       ├── Card.jsx             # Card container with Header, Body, Footer
│       ├── DataTable.jsx        # Data table with loading/empty states
│       ├── EmptyState.jsx       # Zero-state placeholder
│       ├── Input.jsx            # Text & number form input
│       ├── LoadingSpinner.jsx   # SVG loading indicator
│       ├── Modal.jsx            # Modal dialog & ConfirmDialog
│       ├── PageHeader.jsx       # Standard page header with action buttons
│       ├── Select.jsx           # Form dropdown component
│       ├── Skeleton.jsx         # Loading skeleton pulse placeholders
│       ├── StatCard.jsx         # Metric card with indicators
│       ├── StatusBadge.jsx      # Specialized status & severity badges
│       └── Textarea.jsx         # Multi-line text area
├── config/
│   └── geoConfig.js         # Canonical Jodhpur coordinates & OSM config
├── context/
│   └── AuthContext.jsx      # React Context managing session & JWT
├── hooks/
│   └── useAuth.js           # Ergonomic authentication hook
├── layouts/
│   ├── PublicLayout.jsx     # Centered auth layout
│   ├── CitizenLayout.jsx    # Top-nav citizen portal layout
│   └── ControlRoomLayout.jsx# Dark-sidebar operator layout
├── pages/
│   ├── auth/                # Login and Citizen Registration
│   ├── citizen/             # Citizen portal views (Dashboard, Intake, History)
│   └── control-room/        # Operator views (Dashboard, Queue, Dispatch, Fleet)
├── services/
│   ├── apiClient.js         # Centralized Axios client with interceptors
│   ├── authService.js       # Auth API client
│   ├── incidentService.js   # Incidents API client
│   ├── dispatchService.js   # Dispatch & C++ engine client
│   ├── resourceService.js   # Emergency resources client
│   └── hospitalService.js   # Hospital beds client
├── styles/
│   ├── index.css            # Tailwind directives & Leaflet styling
│   └── tokens.js            # Design tokens export
├── App.jsx                  # React Router routes tree
└── main.jsx                 # React root mount
```

---

## 4. Route Hierarchy & Role Authorization

| Path | Layout | Permitted Roles | Target Component | Purpose |
|---|---|---|---|---|
| `/` | N/A | Any | `RootRedirect` | Directs unauthenticated users to `/login`, Citizens to `/citizen/dashboard`, and Operators to `/control-room/dashboard`. |
| `/login` | PublicLayout | Public | `LoginPage` | Authentication form with simulation preset autofill buttons. |
| `/register` | PublicLayout | Public | `RegisterPage` | Citizen registration (strictly bound to CITIZEN role). |
| `/citizen/dashboard` | CitizenLayout | `CITIZEN`, `ADMIN` | `CitizenDashboard` | Citizen welcome shell with DEMO metrics, recent reports, and CTA. |
| `/citizen/report-emergency` | CitizenLayout | `CITIZEN`, `ADMIN` | `CitizenReportEmergency` | Citizen emergency intake shell with category & severity selection. |
| `/citizen/my-incidents` | CitizenLayout | `CITIZEN`, `ADMIN` | `CitizenMyIncidents` | Historical log of reports submitted by the citizen. |
| `/citizen/incidents/:id` | CitizenLayout | `CITIZEN`, `ADMIN` | `CitizenIncidentDetail` | Incident progress tracker with field-sanitized progression. |
| `/control-room/dashboard` | ControlRoomLayout | `OPERATOR`, `ADMIN` | `ControlRoomDashboard` | Command dashboard with Leaflet map, fleet stats, and active incident queue. |
| `/control-room/incidents` | ControlRoomLayout | `OPERATOR`, `ADMIN` | `IncidentQueuePage` | Control room verification and rejection queue. |
| `/control-room/dispatch` | ControlRoomLayout | `OPERATOR`, `ADMIN` | `DispatchPlannerPage` | C++ decision engine recommendation planner shell. |
| `/control-room/active-incidents`| ControlRoomLayout | `OPERATOR`, `ADMIN` | `ActiveOperationsPage` | Active operations, scene arrival, and incident resolution. |
| `/control-room/resources` | ControlRoomLayout | `OPERATOR`, `ADMIN` | `ResourceFleetPage` | Vehicle fleet status and assignment overview. |
| `/control-room/hospitals` | ControlRoomLayout | `OPERATOR`, `ADMIN` | `HospitalNetworkPage` | Hospital network capacity and ICU bed overview. |

---

## 5. API Client & Error Normalization

`apiClient.js` configures an Axios instance with:
- **Base URL:** `import.meta.env.VITE_API_URL || '/api'`.
- **Request Interceptor:** Dynamically attaches `Authorization: Bearer <token>` from localStorage.
- **Response Interceptor:** Automatically unwraps `response.data`.
- **Error Normalizer:** Maps backend error envelopes `{ success: false, message, error: { code, message, details } }` to standard JavaScript error objects.
- **Session Expiration Broadcast:** On HTTP 401 with `TOKEN_EXPIRED` or `ACCOUNT_INACTIVE`, flushes localStorage and emits a window event `'auth:unauthorized'` caught by `AuthContext`.

---

## 6. Geographic Configuration (Jodhpur Urban Area)

Defined in [geoConfig.js](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/config/geoConfig.js):
- **Center:** `[26.2918, 73.0168]` (Latitude, Longitude)
- **Default Zoom:** `13`
- **Tile Layer:** OpenStreetMap `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`
- **Attribution:** `&copy; OpenStreetMap contributors`
- **Bounding Box:** `[72.9485753, 26.2059842, 73.0888716, 26.3536661]` (aligned with OSM Way 31725312)

---

## 7. Verification & Production Build Results

1. **Client Unit Tests:**
   `cd client; npm test` executes 12 unit tests verifying tokens, geographic coordinates, and service module contracts in ~340ms (100% pass).
2. **Production Bundle Compilation:**
   `cd client; npm run build` compiles Vite/Rollup bundle in ~4.8s:
   - `dist/index.html` (0.58 KB)
   - `dist/assets/index-*.css` (42.80 KB)
   - `dist/assets/index-*.js` (475.18 KB)
3. **Backend Regression Safety:**
   `cd server; npm test` executes 180 tests across 59 suites in ~5.2s (100% pass).

