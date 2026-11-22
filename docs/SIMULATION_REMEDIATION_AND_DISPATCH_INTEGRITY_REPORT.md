# Emergency Resource Allocation & Response Management System
## Simulation Remediation, Fleet Seeding & Dispatch Integrity Verification Report

**Project Scope:** Jodhpur Urban Service Area, Rajasthan, India  
**Project Classification:** Academic Engineering Simulation & Decision-Support Prototype  
**Date:** November 18, 2026  

---

> [!IMPORTANT]
> ### ACADEMIC SIMULATION DISCLAIMER
> This software system, including its algorithmic decision engine, resource allocations, hospital capacities, routing geometries, and dispatch recommendations, is strictly an **academic engineering simulation prototype** developed for research, educational, and computational evaluation purposes.
> 
> All emergency fleet assets, depot coordinates, hospital capacities, bed counts, and dispatch timings represent simulated entities within the Jodhpur Urban Service Area. They do **NOT** represent real-world emergency service availability, actual municipal fleet deployments, real-time hospital occupancy, or official government emergency dispatch directives.
>
> In an actual emergency within India, citizens must dial official emergency numbers (**112** for Unified Emergency, **108** for Ambulance, **101** for Fire, or **100** for Police).

---

## 1. Executive Summary

During manual end-to-end verification, a verified incident resulted in a dispatch recommendation with:
- `Total Evaluated: 1 incident`
- `Recommended Vehicles: 0`
- `Recommended Hospital: unavailable`
- `Batch Status: FAILED`
- `UI badge: DISPATCH CONFIRMED` (anomalous state)

### Root Cause Analysis
1. **Empty MongoDB Fleet & Hospital Collections:** While the C++ decision engine and OSM road network dataset (`59,334` nodes, `129,778` edges) were active, the live MongoDB database contained zero emergency fleet resources and zero hospitals. When the recommendation controller built its live snapshot for the C++ engine, `resources: []` and `hospitals: []` were provided, correctly causing the C++ engine to return `batch_status: FAILED` (`NO_RESOURCES_AVAILABLE`).
2. **Backend Dispatch Recommendation Status Masking:** In `dispatchRecommendationService.js`, the saved recommendation document was assigned `recommendationStatus: 'RECOMMENDED'` regardless of whether `batch_status === 'FAILED'`.
3. **Dispatch Confirmation Loop Bypass:** In `dispatchExecutionService.js`, when a recommendation contained 0 allocated vehicles, the vehicle reservation loop performed 0 iterations and proceeded to transition the incident to `DISPATCHED` with empty resource IDs (`assignedResourceIds: []`), saving a confirmed dispatch record for a failed allocation.
4. **Frontend Confirmation Guard Absence:** In `DispatchPlannerPage.jsx`, the "Confirm & Mobilize Fleet" button remained clickable and allowed the modal to open even when `batchStatus === 'FAILED'` or 0 vehicles were allocated.

---

## 2. Remediation Overview

### Part 1: Canonical Jodhpur Simulation Data Seeder
- Implemented [`server/src/utils/bootstrapSimulationData.js`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/server/src/utils/bootstrapSimulationData.js) and standalone CLI [`server/scripts/seedSimulationData.js`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/server/scripts/seedSimulationData.js).
- Integrates deterministic per-record idempotency checking via `Hospital.findOne({ hospitalId })` and `Resource.findOne({ resourceId })`.
- Seeds **3 simulated hospitals** and **15 simulated emergency fleet vehicles** across 5 tactical stations in Jodhpur.
- Validates all depot and facility coordinates strictly against `jodhpur_boundary.geojson` via `isInsideJodhpurBoundary()`.
- Automatically invoked upon backend server startup after privileged user bootstrapping.

### Part 2: Backend Dispatch Execution Integrity
- **Batch Status Invariant:** In [`dispatchRecommendationService.js`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/server/src/services/dispatchRecommendationService.js), recommendations with `data.batch_status === 'FAILED'` now store `recommendationStatus: 'FAILED'`.
- **Pre-execution Guards:** In [`dispatchExecutionService.js`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/server/src/services/dispatchExecutionService.js):
  - Rejects confirmation with HTTP 409 `CANNOT_CONFIRM_FAILED_BATCH` if `recommendation.batchStatus === 'FAILED'` or `recommendation.recommendationStatus === 'FAILED'`.
  - Rejects confirmation with HTTP 409 `CANNOT_DISPATCH_EMPTY_FLEET` if `totalAssignedVehicles === 0`.
  - Rejects confirmation with HTTP 409 `CANNOT_CONFIRM_FAILED_BATCH` if any incident's allocation status is unallocated (e.g. `NO_RESOURCES_AVAILABLE`, `NO_COMPATIBLE_RESOURCES`, `UNALLOCATED`).
  - Enforces atomic invariant inside MongoDB transaction (`withTransaction`) preventing incident status transitions to `DISPATCHED` without at least one assigned vehicle.

### Part 3: Frontend Dispatch Confirmation Blocking & Warning Display
- Modified [`client/src/pages/control-room/DispatchPlannerPage.jsx`](file:///c:/Users/sanja/OneDrive/Desktop/Emergency%20Resource%20Allocation%20System/client/src/pages/control-room/DispatchPlannerPage.jsx):
  - Computes `isBatchFailed = recommendation.batchStatus === 'FAILED' || totalAllocatedVehicles === 0`.
  - Hides "Confirm & Mobilize Fleet" button when `isBatchFailed` is true, replacing it with a prominent badge:
    `<Badge variant="danger" size="md">Cannot Mobilize: 0 Vehicles Allocated (Batch Failed)</Badge>`.
  - Blocks `handleOpenConfirm()` and `handleConfirmDispatch()` programmatically.
  - Displays a dedicated allocation failure alert banner detailing engine failure reasons and unallocated incident summaries.

---

## 3. Inventory Summary

### A. Simulated Hospitals Inventory (3 Facilities)

| Hospital ID | Facility Name | Status | Lat, Lng | ICU Beds | General Beds | Oxygen Beds | Key Capabilities |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **701** | AIIMS Jodhpur (Simulation) | `OPERATIONAL` | `26.240009, 73.006607` | 50 (25 avail) | 500 (200 avail) | 200 (80 avail) | Trauma, ICU, Oxygen, Surgical |
| **702** | MDM Hospital Jodhpur (Simulation) | `OPERATIONAL` | `26.265953, 73.008750` | 30 (15 avail) | 400 (150 avail) | 150 (50 avail) | Trauma, ICU, Burn, Surgical |
| **703** | Mahatma Gandhi Hospital (Simulation) | `OPERATIONAL` | `26.283250, 73.018157` | 25 (10 avail) | 300 (100 avail) | 100 (30 avail) | General, Trauma, ICU, Surgical |

### B. Simulated Fleet Inventory (15 Resources)

| Resource ID | Resource Name | Resource Type | Status | Depot / Station | Osm Node ID | Coordinates |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **101** | ALS Ambulance 101 [AIIMS Depot] | `ALS_AMBULANCE` | `AVAILABLE` | DEPOT-AIIMS-01 | 8520698362 | `26.240009, 73.006607` |
| **102** | ALS Ambulance 102 [AIIMS Depot] | `ALS_AMBULANCE` | `AVAILABLE` | DEPOT-AIIMS-01 | 8520698362 | `26.240500, 73.007000` |
| **103** | BLS Ambulance 103 [AIIMS Depot] | `BLS_AMBULANCE` | `AVAILABLE` | DEPOT-AIIMS-01 | 8520698362 | `26.241000, 73.006500` |
| **201** | Fire Engine 201 [Basni Station] | `FIRE_ENGINE` | `AVAILABLE` | FS-BASNI-02 | 2694302020 | `26.223032, 73.011185` |
| **202** | Fire Engine 202 [Basni Station] | `FIRE_ENGINE` | `AVAILABLE` | FS-BASNI-02 | 2694302020 | `26.223500, 73.011500` |
| **203** | Fire Tender 203 [Basni Station] | `FIRE_TENDER` | `AVAILABLE` | FS-BASNI-02 | 2694302020 | `26.224000, 73.011000` |
| **204** | Rescue Vehicle 204 [Basni Station] | `RESCUE_VEHICLE` | `AVAILABLE` | FS-BASNI-02 | 2694302020 | `26.224500, 73.012000` |
| **301** | ALS Ambulance 301 [Paota Depot] | `ALS_AMBULANCE` | `AVAILABLE` | DEPOT-PAOTA-03 | 3773158752 | `26.301273, 73.042908` |
| **302** | BLS Ambulance 302 [Paota Depot] | `BLS_AMBULANCE` | `AVAILABLE` | DEPOT-PAOTA-03 | 3773158752 | `26.301800, 73.043500` |
| **304** | Fire Engine 304 [Paota Depot] | `FIRE_ENGINE` | `AVAILABLE` | DEPOT-PAOTA-03 | 3773158752 | `26.302500, 73.044000` |
| **305** | Rescue Vehicle 305 [Paota Depot] | `RESCUE_VEHICLE` | `AVAILABLE` | DEPOT-PAOTA-03 | 3773158752 | `26.303000, 73.044500` |
| **401** | ALS Ambulance 401 [Shastri Nagar] | `ALS_AMBULANCE` | `AVAILABLE` | DEPOT-SHASTRI-04 | 5321319416 | `26.265953, 73.008750` |
| **402** | BLS Ambulance 402 [Shastri Nagar] | `BLS_AMBULANCE` | `AVAILABLE` | DEPOT-SHASTRI-04 | 5321319416 | `26.266500, 73.009200` |
| **501** | Fire Tender 501 [Jalori Gate Post] | `FIRE_TENDER` | `AVAILABLE` | POST-JALORI-05 | 2688566058 | `26.288599, 73.018000` |
| **502** | Rescue Vehicle 502 [Jalori Gate Post] | `RESCUE_VEHICLE` | `AVAILABLE` | POST-JALORI-05 | 2688566058 | `26.289000, 73.018500` |

---

## 4. Database Verification Results (Live MongoDB Atlas)

Direct query against MongoDB Atlas cluster confirms full provisioning:
```text
Total Hospitals: 3
Operational Hospitals (status === 'OPERATIONAL'): 3
Total Resources: 15
Available Resources (status === 'AVAILABLE'): 15

Resources Breakdown by Type:
  ALS_AMBULANCE: 4
  BLS_AMBULANCE: 3
  FIRE_ENGINE: 3
  FIRE_TENDER: 2
  RESCUE_VEHICLE: 3
```
- **Seeder Idempotency Verification:** Re-running `seedSimulationData.js` outputs:
  - `Hospitals Created: 0, Hospitals Skipped (already exist): 3`
  - `Resources Created: 0, Resources Skipped (already exist): 15`
  - Existing database records are untouched and not duplicated.

---

## 5. Comprehensive Test Execution Results

### 1. C++ Algorithmic Decision Engine (14 Test Suites)
| Executable | Status | Tests Passed | Tests Failed | Key Metrics / Benchmarks |
| :--- | :--- | :--- | :--- | :--- |
| `test_boundary_validator.exe` | **PASS** | 11 | 0 | Point-in-polygon & bounding box validation |
| `test_dijkstra.exe` | **PASS** | 30 | 0 | 30 canonical pairs audit, 30-iter benchmark |
| `test_dispatch_orchestrator.exe` | **PASS** | 8 | 0 | 50-iteration benchmark across batch sizes 1..50 |
| `test_geojson.exe` | **PASS** | 5 | 0 | Canonical boundary & feature formatting |
| `test_graph_ingestion.exe` | **PASS** | 8 | 0 | 59,334 nodes & 129,778 edges loaded |
| `test_graph_integrity.exe` | **PASS** | 10 | 0 | Adjacency, bidirectional edge checks |
| `test_hospital_matching.exe` | **PASS** | 13 | 0 | Multi-criteria scoring & bed reservation |
| `test_json_protocol.exe` | **PASS** | 5 | 0 | Safe JSON serialization over stdin/stdout |
| `test_polyline.exe` | **PASS** | 6 | 0 | Google polyline encoding/decoding |
| `test_priority_engine.exe` | **PASS** | 9 | 0 | Dynamic severity & victim scoring |
| `test_resource_allocation.exe` | **PASS** | 13 | 0 | Multi-vehicle compatibility & nearest depot |
| `test_route_geometry.exe` | **PASS** | 7 | 0 | Polyline coordinates & length estimation |
| `test_spatial_grid.exe` | **PASS** | 21 | 0 | 384.5x speedup over brute force (12 µs query) |
| `test_stress_reliability.exe` | **PASS** | 5 | 0 | 100-cycle repeated batch execution, 0.8 MB net RSS |

### 2. Backend Service Test Suite (Node.js & Express)
- **Execution Command:** `npm --prefix server test`
- **Total Test Suites:** 65
- **Total Tests Passed:** 210
- **Total Tests Failed:** 0
- **Duration:** 8.68 seconds
- **New Test Suites Added:**
  - `server/tests/simulationSeeder.test.js`: 4 tests verifying seeder idempotency, duplicate suppression, partially populated recovery, and custom status preservation.
  - `server/tests/dispatchIntegrity.test.js`: 7 tests verifying rejection of failed batches, rejection of empty fleets, rejection of unallocated statuses, invariant preventing status transition without resources, and successful multi-resource atomic reservation.

### 3. Frontend Client Test Suite (React 18 & Vitest)
- **Execution Command:** `npm --prefix client test`
- **Total Test Suites:** 30
- **Total Tests Passed:** 92
- **Total Tests Failed:** 0
- **Duration:** 0.82 seconds
- **New Test Suites Added:**
  - `client/tests/dispatchAndFleetWorkflow.test.js`: Guard invariant tests confirming `isBatchFailed` calculation, modal blocking, and failure badge display.

### 4. Frontend Production Build
- **Execution Command:** `npm --prefix client run build`
- **Status:** **SUCCESS** (0 errors)
- **Build Duration:** 10.16 seconds
- **Generated Chunks:**
  - `dist/index.html`: `0.58 kB`
  - `dist/assets/index-C3psWqU9.css`: `50.05 kB` (gzip: `12.98 kB`)
  - `dist/assets/index-BGdOKJ-N.js`: `605.91 kB` (gzip: `175.24 kB`)

---

## 6. Files Created & Modified

| File | Change Type | Purpose |
| :--- | :--- | :--- |
| `server/src/utils/bootstrapSimulationData.js` | **Created** | Seeds 3 Jodhpur hospitals and 15 fleet resources idempotently with coordinate validation. |
| `server/scripts/seedSimulationData.js` | **Created** | Standalone CLI script to trigger simulation bootstrapping directly. |
| `server/src/server.js` | **Modified** | Automatically calls `bootstrapSimulationData()` during backend initialization. |
| `server/src/config/env.js` | **Modified** | Robust relative path resolution for `.env`, `cpp_engine` data, and canonical GeoJSON across all launch working directories. |
| `server/src/services/dispatchRecommendationService.js` | **Modified** | Correctly maps `data.batch_status === 'FAILED'` to `recommendationStatus: 'FAILED'`. |
| `server/src/services/dispatchExecutionService.js` | **Modified** | Blocks confirmation of failed batches or 0-vehicle fleets with HTTP 409, prevents incident transition to `DISPATCHED` with 0 resources. |
| `client/src/pages/control-room/DispatchPlannerPage.jsx` | **Modified** | Disables/hides mobilization button when batch fails or fleet is empty; displays `"Cannot Mobilize: 0 Vehicles Allocated (Batch Failed)"` badge and failure reason. |
| `server/tests/simulationSeeder.test.js` | **Created** | Unit and idempotency tests for simulation data seeder. |
| `server/tests/dispatchIntegrity.test.js` | **Created** | Integration tests for backend dispatch execution integrity and empty fleet rejection. |
| `client/tests/dispatchAndFleetWorkflow.test.js` | **Modified** | Added frontend test assertions for dispatch confirmation guards. |

---

## 7. Step-by-Step Manual Verification Guide

To test the end-to-end emergency response workflow with the newly seeded fleet resources:

### Step 1: Start Backend and Frontend Services
1. In a terminal, start the backend:
   ```powershell
   cd server
   npm start
   ```
   *Expected startup log:*
   ```text
   [BOOTSTRAP] Seeded simulated hospital #701: AIIMS Jodhpur (Simulation)
   ...
   [BOOTSTRAP] Seeded simulated resource #101: ALS Ambulance 101 [AIIMS Depot] (Simulation)
   ...
   [SERVER] HTTP Server listening on port 5000
   ```
2. In a second terminal, start the frontend:
   ```powershell
   cd client
   npm run dev
   ```
   *Open browser at `http://localhost:5173`*.

### Step 2: Report an Incident as Citizen
1. Navigate to `http://localhost:5173/register` and register a citizen account (e.g. `citizen@example.com`).
2. Log in and navigate to **Report Emergency** (`/citizen/report`).
3. Enter:
   - **Emergency Category:** `Medical Emergency` or `Traffic Collision / Road Accident`
   - **Severity:** `4 - High`
   - **Victim Count:** `2`
   - **Location:** Click on the map near Sojati Gate / Jalori Gate (`26.2918, 73.0168`) within the green Jodhpur boundary polygon.
4. Click **Submit Emergency Report**. Verify status shows `REPORTED`.

### Step 3: Verify the Incident as Operator
1. In an incognito window or after logging out, navigate to `http://localhost:5173/control-room/login`.
2. Log in using the provisioned operator credentials (`operator@jodhpur.emergency.gov.in`).
3. Navigate to **Incident Queue** (`/control-room/incidents`).
4. Locate the newly reported incident and click **Verify**.
5. Add verification notes: `"Confirmed road collision near Sojati Gate"` and click **Confirm Verification**. Status updates to `VERIFIED`.

### Step 4: Generate Dispatch Recommendation
1. Navigate to **Dispatch Planner** (`/control-room/dispatch-planner`).
2. Select the verified incident checkbox.
3. Click **Generate Dispatch Recommendations**.
4. Observe the recommendation results:
   - **Total Evaluated:** `1 incident`
   - **Fully Allocated:** `1 incident`
   - **Batch Status:** `SUCCESS` (or `OPTIMAL`)
   - **Recommended Vehicles:** Compatible ambulance/fire units (e.g. `ALS Ambulance 101`, `BLS Ambulance 103`)
   - **Recommended Hospital:** `AIIMS Jodhpur` or `MDM Hospital` with designated bed reservations
   - **C++ Engine Wallclock:** `~5 to 25 ms`
   - **Interactive Route Map:** Encoded polyline is rendered on the Leaflet map showing vehicle-to-scene and scene-to-hospital trajectories.

### Step 5: Confirm Dispatch & Mobilize Fleet
1. Notice that the green **Confirm & Mobilize Fleet** button is now active (not disabled).
2. Click **Confirm & Mobilize Fleet**.
3. In the confirmation modal, enter confirmation notes and click **Confirm & Mobilize**.
4. Observe:
   - Status updates to `DISPATCH CONFIRMED`.
   - Incident status transitions to `DISPATCHED`.
   - Assigned resources in **Resource Fleet** (`/control-room/resources`) transition from `AVAILABLE` to `DISPATCHED`.
   - Hospital beds in **Hospital Network** (`/control-room/hospitals`) are accurately reserved.
   - Citizen can see the active dispatched state with live timestamps on their tracking page (`/citizen/incidents/:id`).
