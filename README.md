# Emergency Resource Allocation & Response Management System
## Geographic Scope: Jodhpur, Rajasthan, India

> **ACADEMIC PROTOTYPE DISCLAIMER**  
> This project is a computer science engineering minor project developed solely for academic research, algorithm demonstration, and educational purposes. It is **NOT** connected to live municipal emergency services (108, 101, 100), actual government control rooms, real hospital capacity monitors, or live fleet GPS telemetry. All data is simulated for demonstration.

---

## 1. Project Overview
The **Emergency Resource Allocation & Response Management System** is a full-stack decision-support platform designed to simulate emergency triage, shortest-path road navigation, and optimal fleet dispatch for **Jodhpur, Rajasthan**.

Citizens report emergencies with GPS or map coordinates, and central control room dispatchers verify incidents, receive algorithmic recommendations from a native **C++17 engine** (powered by Dijkstra's algorithm and Multi-Criteria Priority Queues), and coordinate responses across simulated ambulances, fire tenders, and hospitals.

---

## 2. Six Architectural Principles

1. **Authentic Jodhpur Geographic Boundary**: Uses official GeoJSON municipal boundary polygons with backend point-in-polygon validation instead of simplistic rectangular approximations.
2. **Authentic Road Network**: Graph topology extracted from OpenStreetMap (OSM) for Jodhpur, modeling real road intersections, distances, and speed categories.
3. **Explicit Multi-Criteria Priority Queue**: Triage urgency determined dynamically:
   $$\text{Urgency Score} = 50\% \times \text{Severity} + 30\% \times \text{Victims} + 20\% \times \text{Waiting Time}$$
4. **Compatible Resource Allocation**: Enforces vehicle compatibility (ALS/BLS, Fire, Rescue), capacity constraints, and atomic reservation to prevent duplicate dispatches.
5. **Capacity-Aware Hospital Recommendation**: Selects hospitals by balancing road transit time against real-time simulated ICU and emergency bed availability.
6. **Standardized Incident Lifecycle**: Strict state machine: `REPORTED` $\rightarrow$ `VERIFIED` $\rightarrow$ `ALLOCATED` $\rightarrow$ `DISPATCHED` $\rightarrow$ `ON_SCENE` $\rightarrow$ `RESOLVED` (plus `CANCELLED` / `REJECTED`).

---

## 3. Technology Stack

- **Frontend**: React 18, Vite, Tailwind CSS (Slate × Ice Blue theme tokens), Lucide React, React Leaflet (GIS phase).
- **Backend**: Node.js (ES Modules), Express.js, REST APIs, Child Process IPC.
- **Database**: MongoDB & Mongoose with `2dsphere` spatial indexing (Database phase).
- **Core Algorithmic Engine**: C++17 native binary running Graph, Dijkstra's algorithm, Min-Heap, and Max-Heap Priority Queues.
- **Design System**: Slate × Ice Blue enterprise dashboard theme.

---

## 4. Project Structure

```
Emergency-Resource-Allocation-System/
├── client/                               # Frontend (React 18 + Vite + Tailwind CSS)
│   ├── public/                           # Static assets
│   ├── src/
│   │   ├── assets/                       # Custom SVG icons, branding
│   │   ├── components/                   # Reusable UI components
│   │   │   ├── common/                   # Shared buttons, badges, modals
│   │   │   ├── layout/                   # Navbar, sidebar, headers
│   │   │   └── map/                      # Leaflet map container & overlays
│   │   ├── context/                      # React contexts
│   │   ├── hooks/                        # Custom React hooks
│   │   ├── pages/                        # Role-based route views
│   │   │   ├── citizen/                  # Incident reporting & tracking
│   │   │   ├── control-room/             # Dispatcher dashboard & queue
│   │   │   ├── resources/                # Fleet management
│   │   │   └── hospitals/                # Capacity monitoring
│   │   ├── services/                     # API client services
│   │   ├── styles/                       # Tailwind CSS & design tokens
│   │   ├── utils/                        # Geospatial & helper utilities
│   │   ├── App.jsx                       # Phase 1 verification view
│   │   └── main.jsx                      # Client entry point
│   ├── index.html
│   ├── tailwind.config.js                # Slate × Ice Blue color tokens
│   ├── vite.config.js
│   └── package.json
│
├── server/                               # Backend (Node.js + Express)
│   ├── src/
│   │   ├── config/                       # Environment & boundary configs
│   │   ├── controllers/                  # Route business handlers
│   │   ├── middleware/                   # Error handling & validation
│   │   ├── models/                       # Mongoose database schemas
│   │   ├── routes/                       # Express REST routes
│   │   ├── services/                     # C++ process bridge & GIS
│   │   ├── utils/                        # Loggers & formatters
│   │   └── app.js                        # Server entry point & health check
│   └── package.json
│
├── cpp_engine/                           # Core Algorithmic Engine (C++17)
│   ├── include/                          # Header files (Graph, Dijkstra, PQ)
│   ├── src/
│   │   └── main.cpp                      # Diagnostic entry point & IPC handler
│   ├── tests/                            # Engine unit tests
│   ├── data/                             # OSM road network data
│   ├── bin/                              # Output binary folder
│   └── CMakeLists.txt                    # C++17 build configuration
│
├── docs/                                 # Architectural Documentation
│   ├── ARCHITECTURE.md                   # Multi-tier design & IPC protocol
│   ├── SYSTEM_WORKFLOW.md                # Incident lifecycle state transitions
│   ├── TECH_STACK.md                     # Tech stack specifications
│   └── DESIGN_SYSTEM.md                  # Slate × Ice Blue design system
│
├── .gitignore                            # Git exclusion rules
├── .env.example                          # Environment variables template
└── README.md                             # Project documentation
```

---

## 5. Getting Started & Running the Project

### Prerequisites
- **Node.js**: v18.0.0 or higher (Installed: `v24.11.0`)
- **npm**: v9.0.0 or higher (Installed: `11.6.1`)
- **Git**: Installed (`2.51.0`)
- **C++ Compiler**: GCC with C++17 support (MinGW GCC or MSYS2 MinGW-w64)

---

### Step 1: Running the Backend Server
```bash
# Navigate to the server folder
cd server

# Install dependencies (already executed in Phase 1)
npm install

# Start the Express server
npm start
```
The backend starts on port **5000**.  
Verify health by visiting: `http://localhost:5000/api/health`

---

### Step 2: Running the Frontend Client
In a separate terminal:
```bash
# Navigate to the client folder
cd client

# Install dependencies (already executed in Phase 1)
npm install

# Start Vite development server
npm run dev
```
The frontend starts at: `http://localhost:3000` (or `http://localhost:5173`)  
Vite automatically proxies `/api/*` requests to the backend server at `http://localhost:5000`.

---

### Step 3: Compiling & Testing the C++ Algorithmic Engine
```bash
# Navigate to cpp_engine
cd cpp_engine

# Compile with g++
g++ -std=c++17 -O2 src/main.cpp -o bin/engine.exe

# Run the engine binary
./bin/engine.exe
```
**Output (Standard JSON over stdout)**:
```json
{
  "status": "INITIALIZED",
  "engine": "Jodhpur Emergency Dispatch Engine",
  "version": "1.0.0-phase1",
  "cpp_standard": 201500
}
```

---

## 6. Compiler Compatibility Report

- **Detected Compiler**: MinGW GCC 6.3.0 (`C:\MinGW\bin\g++.exe`).
- **Standard Flag**: `-std=c++1z` / `-std=c++17` sets `__cplusplus` to `201500L` (draft C++17).
- **Evaluation**: GCC 6.3.0 supports core C++14 and experimental C++17 features, compiling and executing the Phase 1 diagnostic binary.
- **Recommendation for Future Algorithm Phases**: For complete modern C++17 STL support (including structured bindings `auto [a, b]`, complete `<filesystem>`, and modern variants), it is recommended to install a 64-bit GCC 11+ compiler (such as via [w64devkit](https://github.com/skeeto/w64devkit) or `winget install MSYS2.MSYS2`).
