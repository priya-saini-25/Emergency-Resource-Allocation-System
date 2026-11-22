# 🚨 Emergency Resource Allocation & Response Management System

A MERN Stack and C++17 based Emergency Resource Allocation and Response Management System designed for the Jodhpur urban area.

The system helps citizens report emergencies and enables control room operators to verify incidents, monitor emergency resources, and make intelligent dispatch decisions using graph algorithms and priority-based resource allocation.

---

## Architecture Diagram
             CITIZEN PORTAL
                    |
                    v
              REACT FRONTEND
                    |
                    v
             NODE.JS / EXPRESS
                    |
          +---------+---------+
          |         |         |
          v         v         v
       MongoDB   C++ Engine  Notifications
                    |
             +------+------+
             |      |      |
             v      v      v
          Dijkstra Priority Hospital
           Route   Queue   Matching

## 📌 Project Overview

Emergency situations require quick decision-making, efficient resource utilization, and coordination between emergency response teams.

This project aims to provide a centralized platform that connects citizens with emergency control room operators and supports efficient allocation of ambulances, fire engines, and rescue resources.

The system uses a C++ decision engine to calculate optimal routes and generate resource allocation recommendations based on emergency priority, resource availability, and geographical distance.

**Project Scope:** Jodhpur Urban Area  
**Project Type:** Academic Minor Project  
**Architecture:** MERN Stack + C++ Decision Engine

---

## ✨ Key Features

### 👤 Citizen Portal
- User registration and authentication.
- Report emergencies through an interactive map.
- Search and select locations by name.
- Submit emergency category, severity, and victim details.
- Track reported incidents and their current status.
- View incident details and response progress.

### 🖥️ Control Room Dashboard
- Centralized emergency monitoring dashboard.
- View and manage incoming emergency reports.
- Verify incidents through reporter call verification.
- Monitor active emergency operations.
- Track emergency resources and their availability.
- View hospitals and their available facilities.
- Review dispatch recommendations and allocate resources.
- Receive notifications for important incident updates.

### 🚑 Emergency Resource Management
- Manage ambulances, fire engines, and rescue resources.
- Track resource locations and operational status.
- Consider resource availability during allocation.
- Monitor dispatch, arrival, and incident resolution workflows.

### 🧠 Intelligent C++ Decision Engine
- Dijkstra's shortest path algorithm for route calculation.
- Priority Queue for emergency prioritization.
- Graph-based geographical route representation.
- Spatial Grid for geographical lookup.
- Resource allocation and dispatch recommendations.
- Hospital matching based on requirements and capacity.
- JSON-based communication between the backend and C++ engine.

### 🔔 Notification System
- Notify control room operators when a new emergency is reported.
- Display notifications for incident verification.
- Show resource allocation and dispatch updates.
- Provide status updates throughout the incident lifecycle.

### 🗺️ Interactive Mapping
- Interactive maps using Leaflet and OpenStreetMap.
- Location search and geographical visualization.
- Display emergency incidents and available resources.
- Visualize routes and dispatch information.

---

## 🛠️ Technology Stack

| Category | Technologies |
|---|---|
| Frontend | React.js, Vite, JavaScript |
| Backend | Node.js, Express.js |
| Database | MongoDB, Mongoose |
| Decision Engine | C++17 |
| Algorithms | Dijkstra, Priority Queue, Graph Algorithms, Spatial Grid |
| Mapping | Leaflet, OpenStreetMap |
| API Communication | REST APIs, JSON |
| Authentication | JWT |
| Testing | Automated Frontend, Backend and C++ Tests |
| Version Control | Git, GitHub |

---

## 🏗️ System Architecture

The application follows a modular architecture in which the React frontend communicates with the Node.js backend through REST APIs.

The backend manages authentication, incident workflows, resource management, hospital information, and dispatch execution.

For intelligent dispatch recommendations, the backend communicates with an isolated C++17 decision engine using JSON over standard input/output.

The system uses MongoDB for persistent data storage.

### High-Level Workflow

1. A citizen reports an emergency through the Citizen Portal.
2. The backend validates and stores the incident.
3. The control room receives the new incident notification.
4. An operator verifies the emergency.
5. The dispatch engine evaluates emergency priority and available resources.
6. The C++ engine calculates route and allocation recommendations.
7. The operator reviews and executes the dispatch.
8. The system tracks resource arrival and incident status until resolution.

---

## 🧮 Core Algorithms

| Algorithm / Data Structure | Purpose |
|---|---|
| Dijkstra's Algorithm | Calculate shortest paths in the road network |
| Priority Queue | Prioritize emergency incidents |
| Graph Data Structure | Represent geographical road networks |
| Spatial Grid | Support efficient geographical lookups |
| Resource Allocation Logic | Generate suitable resource allocation recommendations |
| Hospital Matching | Match incidents with suitable hospitals |

---

## 📂 Project Structure

```text
Emergency-Resource-Allocation-System/
│
├── client/
│   ├── src/
│   │   ├── components/
│   │   ├── config/
│   │   ├── context/
│   │   ├── hooks/
│   │   ├── layouts/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── styles/
│   │   └── utils/
│   └── tests/
│
├── server/
│   ├── scripts/
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── middleware/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── services/
│   │   └── utils/
│   └── tests/
│
├── cpp_engine/
│   ├── include/
│   ├── src/
│   ├── tests/
│   └── CMakeLists.txt
│
├── docs/
│
├── .env.example
└── README.md
```

---

## ⚙️ Installation & Setup

### Prerequisites

Install the following before running the project:

- Node.js and npm
- MongoDB (local instance or MongoDB Atlas)
- C++17 compatible compiler
- CMake
- Git

### 1. Clone the Repository

```bash
git clone https://github.com/priya-saini-25/Emergency-Resource-Allocation-System.git
```

```bash
cd Emergency-Resource-Allocation-System
```

### 2. Configure Environment Variables

Create the required environment files using the provided examples.

For the backend:

```bash
cd server
```

Copy `.env.example` to `.env` and configure the required environment variables.

For the frontend, configure its environment variables according to the client configuration.

**Important:** Never commit actual credentials, database connection strings, JWT secrets, or private environment files.

### 3. Install Backend Dependencies

```bash
cd server
npm install
```

Start the backend using the development script defined in `server/package.json`.

### 4. Install Frontend Dependencies

Open another terminal:

```bash
cd client
npm install
```

Start the frontend using the development script defined in `client/package.json`.

### 5. Build the C++ Decision Engine

Open a terminal in the project root:

```bash
cd cpp_engine
cmake -S . -B build
cmake --build build
```

Ensure the backend C++ engine configuration points to the generated executable.

---

## 🧪 Testing

The project contains automated tests across its major modules:

- Frontend workflow tests.
- Backend API and integration tests.
- Authentication and authorization tests.
- Incident lifecycle and dispatch tests.
- Resource allocation and hospital matching tests.
- C++ graph, routing, priority, and allocation tests.

Run the relevant test scripts defined in each module's `package.json` and C++ build configuration.

---

## 📚 Documentation

Detailed technical documentation is available in the `docs/` directory.

Some important documents include:

- `API_REFERENCE.md` — Backend API documentation.
- `BACKEND_ARCHITECTURE.md` — Backend architecture.
- `CPP_ENGINE_INTEGRATION.md` — C++ engine integration.
- `INCIDENT_LIFECYCLE.md` — Incident lifecycle.
- `DISPATCH_RECOMMENDATION_API.md` — Dispatch recommendation workflow.
- `AUTHENTICATION_AND_AUTHORIZATION.md` — Security and access control.
- `PHASE_8_END_TO_END_ACCEPTANCE_REPORT.md` — End-to-end acceptance report.

---

## 🔐 Security & Scope

- Environment variables are used for sensitive configuration.
- Authentication and authorization protect application routes.
- Backend APIs validate incoming requests.
- The project is designed as an academic simulation and decision-support platform.

**Disclaimer:** This system is an academic project and is not intended to replace real-world emergency response infrastructure or official emergency services.

---

## 🎯 Future Enhancements

- Live GPS tracking of emergency response vehicles.
- Real-time communication between operators and response teams.
- Integration with verified emergency service providers.
- Advanced traffic-aware route optimization.
- Enhanced analytics and operational performance reports.
- Mobile application for emergency reporting.

---

## 👩‍💻 Project Information

**Project Name:** Emergency Resource Allocation & Response Management System

**Technology:** MERN Stack + C++17

**Geographical Focus:** Jodhpur Urban Area

**Developed as:** Final-Year Academic Minor Project

**GitHub Repository:**  
https://github.com/priya-saini-25/Emergency-Resource-Allocation-System

---

⭐ If you find this project interesting, consider giving the repository a star!
