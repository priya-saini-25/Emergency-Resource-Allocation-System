cmake_minimum_required(VERSION 3.10)
project(JodhpurEmergencyEngine VERSION 1.0.0 LANGUAGES CXX)

# Enforce C++17 standard
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Optimization and warning flags
if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
    add_compile_options(-Wall -Wextra -pedantic -O3)
endif()

# Include directories
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/include)

# Core routing static library
add_library(routing_core STATIC
    src/Graph.cpp
    src/DataLoader.cpp
    src/GraphIntegrity.cpp
    src/GraphConnectivity.cpp
    src/Dijkstra.cpp
    src/RouteGeometry.cpp
    src/GeoJSONExporter.cpp
    src/PolylineEncoder.cpp
    src/BoundaryValidator.cpp
    src/SpatialGrid.cpp
    src/PriorityEngine.cpp
    src/ResourceAllocationEngine.cpp
    src/HospitalMatchingEngine.cpp
    src/DispatchOrchestrator.cpp
    src/JsonConverters.cpp
    src/EngineRunner.cpp
)

# Platform libraries (PSAPI for Windows memory profiling)
if(WIN32)
    target_link_libraries(routing_core PUBLIC psapi)
endif()

# Set runtime output directory for all executables
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/bin)

# Main engine executable
add_executable(engine src/main.cpp)
target_link_libraries(engine PRIVATE routing_core)

# Phase 3.2 Ingestion Test executable (expanded in 3.3)
add_executable(test_graph_ingestion tests/test_graph_ingestion.cpp)
target_link_libraries(test_graph_ingestion PRIVATE routing_core)

# Phase 3.3 Full Graph Integrity & Memory Audit executable
add_executable(test_graph_integrity tests/test_graph_integrity.cpp)
target_link_libraries(test_graph_integrity PRIVATE routing_core)

# Phase 3.4 Dijkstra Shortest-Path Test executable
add_executable(test_dijkstra tests/test_dijkstra.cpp)
target_link_libraries(test_dijkstra PRIVATE routing_core)

# Phase 3.5 Polyline Encoder Test executable
add_executable(test_polyline tests/test_polyline.cpp)
target_link_libraries(test_polyline PRIVATE routing_core)

# Phase 3.5 GeoJSON Exporter Test executable
add_executable(test_geojson tests/test_geojson.cpp)
target_link_libraries(test_geojson PRIVATE routing_core)

# Phase 3.5 Route Geometry & Canonical Verification Test executable
add_executable(test_route_geometry tests/test_route_geometry.cpp)
target_link_libraries(test_route_geometry PRIVATE routing_core)

# Phase 3.6 Boundary Validator Test executable
add_executable(test_boundary_validator tests/test_boundary_validator.cpp)
target_link_libraries(test_boundary_validator PRIVATE routing_core)

# Phase 3.6 Spatial Grid Test executable
add_executable(test_spatial_grid tests/test_spatial_grid.cpp)
target_link_libraries(test_spatial_grid PRIVATE routing_core)

# Phase 3.8 Priority Engine Test executable
add_executable(test_priority_engine tests/test_priority_engine.cpp)
target_link_libraries(test_priority_engine PRIVATE routing_core)

# Phase 3.9 Resource Allocation Engine Test executable
add_executable(test_resource_allocation tests/test_resource_allocation.cpp)
target_link_libraries(test_resource_allocation PRIVATE routing_core)

# Phase 3.10 Hospital Matching Engine Test executable
add_executable(test_hospital_matching tests/test_hospital_matching.cpp)
target_link_libraries(test_hospital_matching PRIVATE routing_core)

# Phase 3.11 Dispatch Orchestrator Test executable
add_executable(test_dispatch_orchestrator tests/test_dispatch_orchestrator.cpp)
target_link_libraries(test_dispatch_orchestrator PRIVATE routing_core)

# Phase 3.12 JSON Protocol & stdin/stdout Interface Test executable
add_executable(test_json_protocol tests/test_json_protocol.cpp)
target_link_libraries(test_json_protocol PRIVATE routing_core)

# Phase 3.13 Stress, Invariant & Reliability Test executable
add_executable(test_stress_reliability tests/test_stress_reliability.cpp)
target_link_libraries(test_stress_reliability PRIVATE routing_core)


