# Technology Stack & Responsibilities
## Emergency Resource Allocation & Response Management System

---

### 1. Technology Breakdown

| Tier / Component | Technology | Version / Standard | Primary Responsibilities |
| :--- | :--- | :--- | :--- |
| **Frontend Framework** | React.js | `^18.3.1` | Component-based UI, client state management, responsive view rendering. |
| **Build Tooling** | Vite | `^5.4.11` | High-speed ESM development server, hot module reloading (HMR), production bundling. |
| **Styling & Design System** | Tailwind CSS | `^3.4.17` | Utility-first styling utilizing centralized **Slate × Ice Blue** design tokens. |
| **Icons** | Lucide React | `^0.468.0` | Minimal, lightweight SVG icons for cards, headers, and status badges. |
| **Map Rendering** | React Leaflet / Leaflet.js | Planned for GIS Phase | OpenStreetMap tile display, custom markers for ambulances, incident points, and Dijkstra route polylines. |
| **Backend Runtime** | Node.js (ES Modules) | `v24.11.0` | Asynchronous JavaScript runtime executing the API gateway and subprocess IPC. |
| **Server Framework** | Express.js | `^4.21.2` | RESTful routing, CORS management, request validation, error handling middleware. |
| **Process IPC** | Node `child_process` | Built-in | Invoking standalone C++ native binary via `stdin`/`stdout` JSON streaming. |
| **Database** | MongoDB | Document Store | Persistent storage of user accounts, incident lifecycles, vehicle telemetry, and hospital capacities. |
| **ODM** | Mongoose | Planned for DB Phase | Object Data Modeling with schema validation and `2dsphere` spatial indexing. |
| **Core Algorithmic Engine**| C++17 | GCC / MinGW C++17 | Execution of graph traversals, Dijkstra shortest path, Min-Heap, and Multi-Criteria Priority Queues. |
| **Build System (C++)** | CMake / Direct GCC CLI | CMake 3.10+ | Compiling C++ engine into a standalone, portable native executable. |

---

### 2. Architectural Boundaries & Data Flow Isolation

1. **Client / Server Boundary**:
   - The React frontend communicates strictly over HTTP REST endpoints (`/api/*`).
   - No direct database access or C++ execution occurs on the client.

2. **Server / Algorithmic Core Boundary**:
   - Node.js owns database queries and data preparation.
   - Node passes a standardized JSON payload over standard input to the C++ engine.
   - C++ standard output is reserved strictly for valid JSON computation results.
   - C++ standard error is used for diagnostic logging.

3. **Academic Simulation Boundary**:
   - All vehicle movements, hospital capacities, and emergency dispatches operate in simulation mode.
   - Distinct disclaimers are visibly rendered across UI views.
