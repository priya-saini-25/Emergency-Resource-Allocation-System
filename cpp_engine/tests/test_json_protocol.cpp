#include "EngineRunner.hpp"
#include "JsonProtocol.hpp"
#include "JsonConverters.hpp"
#include "DataLoader.hpp"
#include "MemoryProfiler.hpp"

#include <iostream>
#include <sstream>
#include <cassert>
#include <cmath>
#include <limits>
#include <chrono>
#include <cstdlib>

using namespace EmergencyRouting;
using namespace EmergencyRouting::Protocol;

#define TEST_ASSERT(cond, msg) \
    do { \
        if (!(cond)) { \
            std::cerr << "[TEST_FAIL] " << __FUNCTION__ << ":" << __LINE__ << " - " << msg << std::endl; \
            return false; \
        } \
    } while (0)

// Helper to construct synthetic test graph:
// 0 <-> 1 <-> 2 <-> 3 <-> 4 (linear bidirectional road, 100m each)
static Graph BuildSyntheticGraph() {
    Graph g;
    g.AddNode(10, 26.25, 73.00, false); // Node 0
    g.AddNode(20, 26.26, 73.01, false); // Node 1
    g.AddNode(30, 26.27, 73.02, false); // Node 2
    g.AddNode(40, 26.28, 73.03, false); // Node 3
    g.AddNode(50, 26.29, 73.04, false); // Node 4

    for (uint32_t i = 0; i < 4; ++i) {
        g.AddEdge(i, i + 1, 100.0, i + 1, 0, 0, 0, false, {});
        g.AddEdge(i + 1, i, 100.0, i + 1, 0, 0, 0, false, {});
    }
    return g;
}

// ============================================================================
// 1. PROTOCOL ENVELOPE & VALIDATION TESTS
// ============================================================================

bool Test1_EnvelopeValidation() {
    std::cout << "Running Test1_EnvelopeValidation..." << std::endl;
    EngineRunner runner;
    std::string out;

    // 1a. Empty input
    int code = runner.ExecuteJsonRequest("", out);
    TEST_ASSERT(code == ExitCode::PROTOCOL_OR_REQUEST_ERROR, "Empty input must return exit code 1");
    auto j1 = nlohmann::json::parse(out);
    TEST_ASSERT(j1["status"] == "error", "Status must be error");
    TEST_ASSERT(j1["error"]["code"] == ErrorCode::EMPTY_INPUT, "Error code must be EMPTY_INPUT");

    // 1b. Whitespace-only input
    code = runner.ExecuteJsonRequest("   \t\n\r  ", out);
    TEST_ASSERT(code == ExitCode::PROTOCOL_OR_REQUEST_ERROR, "Whitespace input must return exit code 1");
    auto j2 = nlohmann::json::parse(out);
    TEST_ASSERT(j2["error"]["code"] == ErrorCode::EMPTY_INPUT, "Error code must be EMPTY_INPUT");

    // 1c. Malformed JSON syntax
    code = runner.ExecuteJsonRequest("{ \"invalid_json\": true, ", out);
    TEST_ASSERT(code == ExitCode::PROTOCOL_OR_REQUEST_ERROR, "Malformed JSON must return exit code 1");
    auto j3 = nlohmann::json::parse(out);
    TEST_ASSERT(j3["error"]["code"] == ErrorCode::INVALID_JSON, "Error code must be INVALID_JSON");

    // 1d. Top-level not an object
    code = runner.ExecuteJsonRequest("[1, 2, 3]", out);
    TEST_ASSERT(code == ExitCode::PROTOCOL_OR_REQUEST_ERROR, "Non-object JSON must return exit code 1");
    auto j4 = nlohmann::json::parse(out);
    TEST_ASSERT(j4["error"]["code"] == ErrorCode::INVALID_REQUEST, "Error code must be INVALID_REQUEST");

    // 1e. Missing request_id
    code = runner.ExecuteJsonRequest(R"({
        "protocol_version": "1.0",
        "operation": "dispatch_batch",
        "payload": {}
    })", out);
    TEST_ASSERT(code == ExitCode::PROTOCOL_OR_REQUEST_ERROR, "Missing request_id must fail");
    auto j5 = nlohmann::json::parse(out);
    TEST_ASSERT(j5["error"]["code"] == ErrorCode::INVALID_REQUEST, "Error code must be INVALID_REQUEST");

    // 1f. Empty request_id
    code = runner.ExecuteJsonRequest(R"({
        "request_id": "",
        "protocol_version": "1.0",
        "operation": "dispatch_batch",
        "payload": {}
    })", out);
    TEST_ASSERT(code == ExitCode::PROTOCOL_OR_REQUEST_ERROR, "Empty request_id must fail");

    // 1g. Unsupported protocol version
    code = runner.ExecuteJsonRequest(R"({
        "request_id": "REQ-001",
        "protocol_version": "9.9",
        "operation": "dispatch_batch",
        "payload": {}
    })", out);
    TEST_ASSERT(code == ExitCode::PROTOCOL_OR_REQUEST_ERROR, "Unsupported protocol_version must fail");
    auto j6 = nlohmann::json::parse(out);
    TEST_ASSERT(j6["error"]["code"] == ErrorCode::INVALID_PROTOCOL_VERSION, "Error code must be INVALID_PROTOCOL_VERSION");

    // 1h. Unknown operation
    code = runner.ExecuteJsonRequest(R"({
        "request_id": "REQ-002",
        "protocol_version": "1.0",
        "operation": "unsupported_op",
        "payload": {}
    })", out);
    TEST_ASSERT(code == ExitCode::PROTOCOL_OR_REQUEST_ERROR, "Unknown operation must fail");
    auto j7 = nlohmann::json::parse(out);
    TEST_ASSERT(j7["error"]["code"] == ErrorCode::UNKNOWN_OPERATION, "Error code must be UNKNOWN_OPERATION");

    // 1i. Missing payload object
    code = runner.ExecuteJsonRequest(R"({
        "request_id": "REQ-003",
        "protocol_version": "1.0",
        "operation": "dispatch_batch"
    })", out);
    TEST_ASSERT(code == ExitCode::PROTOCOL_OR_REQUEST_ERROR, "Missing payload must fail");

    std::cout << "Test1_EnvelopeValidation passed." << std::endl;
    return true;
}

// ============================================================================
// 2. PAYLOAD PARSING & VALIDATION TESTS
// ============================================================================

bool Test2_PayloadValidation() {
    std::cout << "Running Test2_PayloadValidation..." << std::endl;
    EngineRunner runner;
    std::string out;

    // 2a. Missing batch_id and evaluated_at_ms
    int code = runner.ExecuteJsonRequest(R"({
        "request_id": "REQ-BATCH-01",
        "protocol_version": "1.0",
        "operation": "dispatch_batch",
        "payload": {
            "incidents": []
        }
    })", out);
    TEST_ASSERT(code == ExitCode::PROTOCOL_OR_REQUEST_ERROR, "Missing batch_id must fail");
    auto j1 = nlohmann::json::parse(out);
    TEST_ASSERT(j1["error"]["code"] == ErrorCode::INVALID_REQUEST, "Error code must be INVALID_REQUEST");
    TEST_ASSERT(!j1["error"]["details"].empty(), "Details array must contain validation errors");

    // 2b. Empty incidents array
    code = runner.ExecuteJsonRequest(R"({
        "request_id": "REQ-BATCH-02",
        "protocol_version": "1.0",
        "operation": "dispatch_batch",
        "payload": {
            "batch_id": 100,
            "evaluated_at_ms": 1700000000000,
            "incidents": []
        }
    })", out);
    TEST_ASSERT(code == ExitCode::PROTOCOL_OR_REQUEST_ERROR, "Empty incidents array must fail");

    // 2c. Invalid incident fields (severity = 10, invalid category)
    code = runner.ExecuteJsonRequest(R"({
        "request_id": "REQ-BATCH-03",
        "protocol_version": "1.0",
        "operation": "dispatch_batch",
        "payload": {
            "batch_id": 100,
            "evaluated_at_ms": 1700000000000,
            "incidents": [
                {
                    "incident_id": 1,
                    "category": "ALIEN_INVASION",
                    "severity": 10,
                    "created_at_ms": 1700000000000,
                    "latitude": 26.28,
                    "longitude": 73.02
                }
            ]
        }
    })", out);
    TEST_ASSERT(code == ExitCode::PROTOCOL_OR_REQUEST_ERROR, "Invalid incident category/severity must fail");
    auto j3 = nlohmann::json::parse(out);
    TEST_ASSERT(j3["error"]["details"].size() >= 2, "Expected multiple error details");

    // 2d. Duplicate incident IDs
    code = runner.ExecuteJsonRequest(R"({
        "request_id": "REQ-BATCH-04",
        "protocol_version": "1.0",
        "operation": "dispatch_batch",
        "payload": {
            "batch_id": 100,
            "evaluated_at_ms": 1700000000000,
            "incidents": [
                {
                    "incident_id": 42,
                    "category": "MEDICAL",
                    "severity": 3,
                    "created_at_ms": 1700000000000,
                    "latitude": 26.28,
                    "longitude": 73.02
                },
                {
                    "incident_id": 42,
                    "category": "FIRE",
                    "severity": 4,
                    "created_at_ms": 1700000000000,
                    "latitude": 26.29,
                    "longitude": 73.03
                }
            ]
        }
    })", out);
    TEST_ASSERT(code == ExitCode::PROTOCOL_OR_REQUEST_ERROR, "Duplicate incident IDs must fail");

    // 2e. Duplicate resource IDs
    code = runner.ExecuteJsonRequest(R"({
        "request_id": "REQ-BATCH-05",
        "protocol_version": "1.0",
        "operation": "dispatch_batch",
        "payload": {
            "batch_id": 100,
            "evaluated_at_ms": 1700000000000,
            "incidents": [
                {
                    "incident_id": 1,
                    "category": "MEDICAL",
                    "severity": 3,
                    "created_at_ms": 1700000000000,
                    "latitude": 26.28,
                    "longitude": 73.02
                }
            ],
            "resources": [
                { "resource_id": 10, "resource_type": "ALS_AMBULANCE", "latitude": 26.28, "longitude": 73.02 },
                { "resource_id": 10, "resource_type": "BLS_AMBULANCE", "latitude": 26.29, "longitude": 73.03 }
            ]
        }
    })", out);
    TEST_ASSERT(code == ExitCode::PROTOCOL_OR_REQUEST_ERROR, "Duplicate resource IDs must fail");

    // 2f. Duplicate hospital IDs
    code = runner.ExecuteJsonRequest(R"({
        "request_id": "REQ-BATCH-06",
        "protocol_version": "1.0",
        "operation": "dispatch_batch",
        "payload": {
            "batch_id": 100,
            "evaluated_at_ms": 1700000000000,
            "incidents": [
                {
                    "incident_id": 1,
                    "category": "MEDICAL",
                    "severity": 3,
                    "created_at_ms": 1700000000000,
                    "latitude": 26.28,
                    "longitude": 73.02
                }
            ],
            "hospitals": [
                { "hospital_id": 5, "name": "Hospital A", "latitude": 26.28, "longitude": 73.02 },
                { "hospital_id": 5, "name": "Hospital B", "latitude": 26.29, "longitude": 73.03 }
            ]
        }
    })", out);
    TEST_ASSERT(code == ExitCode::PROTOCOL_OR_REQUEST_ERROR, "Duplicate hospital IDs must fail");

    std::cout << "Test2_PayloadValidation passed." << std::endl;
    return true;
}

// ============================================================================
// 3. SAFE NUMBER & SERIALIZATION TESTS
// ============================================================================

bool Test3_SafeNumberAndSerialization() {
    std::cout << "Running Test3_SafeNumberAndSerialization..." << std::endl;

    double nan_val = std::numeric_limits<double>::quiet_NaN();
    double inf_val = std::numeric_limits<double>::infinity();
    double neg_inf = -std::numeric_limits<double>::infinity();
    double normal_val = 42.5;

    nlohmann::json j_nan = SafeNumber(nan_val);
    TEST_ASSERT(j_nan.is_null(), "SafeNumber(NaN) must serialize as JSON null");

    nlohmann::json j_inf = SafeNumber(inf_val);
    TEST_ASSERT(j_inf.is_null(), "SafeNumber(Inf) must serialize as JSON null");

    nlohmann::json j_neginf = SafeNumber(neg_inf);
    TEST_ASSERT(j_neginf.is_null(), "SafeNumber(-Inf) must serialize as JSON null");

    nlohmann::json j_norm = SafeNumber(normal_val);
    TEST_ASSERT(j_norm.is_number_float(), "SafeNumber(normal) must be float");
    TEST_ASSERT(std::abs(j_norm.get<double>() - 42.5) < 1e-6, "Value must match");

    // Test Error Response Serialization
    ProtocolError err;
    err.code = ErrorCode::INVALID_REQUEST;
    err.message = "Test error message";
    err.details.push_back({"field_a", "must be positive"});

    nlohmann::json err_json = SerializeErrorResponse("1.0", "REQ-TEST", "dispatch_batch", err, 12.34);
    TEST_ASSERT(err_json["status"] == "error", "Status must be error");
    TEST_ASSERT(err_json["protocol_version"] == "1.0", "Protocol version mismatch");
    TEST_ASSERT(err_json["request_id"] == "REQ-TEST", "Request ID mismatch");
    TEST_ASSERT(err_json["operation"] == "dispatch_batch", "Operation mismatch");
    TEST_ASSERT(err_json["error"]["code"] == ErrorCode::INVALID_REQUEST, "Code mismatch");
    TEST_ASSERT(err_json["error"]["details"].size() == 1, "Details size mismatch");

    std::cout << "Test3_SafeNumberAndSerialization passed." << std::endl;
    return true;
}

// ============================================================================
// 4. SYNTHETIC END-TO-END EXECUTION TEST (MEMORY INJECTION)
// ============================================================================

bool Test4_SyntheticEndToEnd() {
    std::cout << "Running Test4_SyntheticEndToEnd..." << std::endl;

    auto g = std::make_shared<Graph>(BuildSyntheticGraph());
    auto grid = std::make_shared<SpatialGrid>();
    grid->Build(*g, 250.0);

    // Create Runner with preloaded components
    EngineRunner runner(g, grid, nullptr);
    TEST_ASSERT(runner.IsInitialized(), "EngineRunner must be initialized");

    std::string request_json = R"({
        "protocol_version": "1.0",
        "request_id": "REQ-SYNTH-001",
        "operation": "dispatch_batch",
        "payload": {
            "batch_id": 1,
            "evaluated_at_ms": 1000000,
            "incidents": [
                {
                    "incident_id": 101,
                    "category": "MEDICAL",
                    "severity": 4,
                    "victim_count": 1,
                    "created_at_ms": 990000,
                    "incident_node_osm_id": 20
                },
                {
                    "incident_id": 102,
                    "category": "FIRE",
                    "severity": 2,
                    "victim_count": 0,
                    "created_at_ms": 995000,
                    "incident_node_osm_id": 30,
                    "resource_demands": [
                        { "type": "FIRE_ENGINE", "quantity": 1 }
                    ]
                }
            ],
            "resources": [
                {
                    "resource_id": 201,
                    "resource_type": "ALS_AMBULANCE",
                    "status": "AVAILABLE",
                    "current_node_osm_id": 10
                },
                {
                    "resource_id": 202,
                    "resource_type": "BLS_AMBULANCE",
                    "status": "AVAILABLE",
                    "current_node_osm_id": 20
                },
                {
                    "resource_id": 203,
                    "resource_type": "FIRE_ENGINE",
                    "status": "AVAILABLE",
                    "current_node_osm_id": 50
                }
            ],
            "hospitals": [
                {
                    "hospital_id": 301,
                    "name": "Synthetic Hospital",
                    "hospital_node_osm_id": 40,
                    "status": "NORMAL",
                    "available_general_beds": 10,
                    "available_icu_beds": 5,
                    "available_oxygen_beds": 5,
                    "capabilities": ["GENERAL_EMERGENCY", "TRAUMA", "BURN_TREATMENT", "OXYGEN_SUPPORT", "SURGICAL_SUPPORT"]
                }
            ]
        }
    })";

    std::string output_json;
    int exit_code = runner.ExecuteJsonRequest(request_json, output_json);
    TEST_ASSERT(exit_code == ExitCode::SUCCESS, "Execution must succeed with exit code 0");

    nlohmann::json resp = nlohmann::json::parse(output_json);
    TEST_ASSERT(resp["status"] == "success", "Response status must be success");
    TEST_ASSERT(resp["protocol_version"] == "1.0", "Protocol version mismatch");
    TEST_ASSERT(resp["request_id"] == "REQ-SYNTH-001", "Request ID mismatch");
    TEST_ASSERT(resp["operation"] == "dispatch_batch", "Operation mismatch");
    TEST_ASSERT(resp.contains("data"), "Response must contain data object");

    const auto& data = resp["data"];
    TEST_ASSERT(data["batch_id"] == 1, "Batch ID mismatch");
    TEST_ASSERT(data["batch_status"] == "SUCCESS", "Batch status must be SUCCESS");
    TEST_ASSERT(data["total_incidents_received"] == 2, "Incident count mismatch");
    TEST_ASSERT(data["fully_allocated_incidents"] == 2, "Fully allocated count mismatch");
    TEST_ASSERT(data["incident_results"].size() == 2, "Result count mismatch");

    // Incident 101 (Medical, severity 4) should have higher priority and be processed first
    const auto& inc0 = data["incident_results"][0];
    TEST_ASSERT(inc0["incident_id"] == 101, "Incident 101 must be processed first");
    TEST_ASSERT(inc0["dispatch_status"] == "FULLY_DISPATCHED", "Incident 101 status mismatch");
    TEST_ASSERT(inc0["resource_allocation"]["status"] == "FULLY_ALLOCATED", "Allocation status mismatch");
    TEST_ASSERT(inc0["hospital_recommendation"]["status"] == "SUITABLE_HOSPITALS_FOUND", "Hospital match status mismatch");
    TEST_ASSERT(inc0["hospital_recommendation"]["recommended_hospital_id"] == 301, "Hospital ID mismatch");

    std::cout << "Test4_SyntheticEndToEnd passed." << std::endl;
    return true;
}

// ============================================================================
// 5. AUTHENTIC JODHPUR DATASET END-TO-END EXECUTION TEST
// ============================================================================

bool Test5_AuthenticJodhpurExecution() {
    std::cout << "Running Test5_AuthenticJodhpurExecution..." << std::endl;

    EngineRunner runner;
    // Will search fallback paths (data/, cpp_engine/data/, ../data/, etc.)
    bool init_ok = runner.Initialize();
    TEST_ASSERT(init_ok, "EngineRunner must initialize authentic Jodhpur datasets");

    // Authentic Jodhpur coordinates:
    // AIIMS Jodhpur: ~26.248, 73.003
    // MDM Hospital: ~26.273, 73.012
    // Incident 1: 26.265, 73.015 (Medical near Shastri Nagar)
    // Incident 2: 26.278, 73.025 (Fire near Paota)
    std::string request_json = R"({
        "protocol_version": "1.0",
        "request_id": "REQ-AUTH-JODHPUR-001",
        "operation": "dispatch_batch",
        "payload": {
            "batch_id": 9001,
            "evaluated_at_ms": 1700000000000,
            "incidents": [
                {
                    "incident_id": 1001,
                    "category": "MEDICAL",
                    "severity": 5,
                    "victim_count": 2,
                    "created_at_ms": 1699999900000,
                    "latitude": 26.265,
                    "longitude": 73.015
                },
                {
                    "incident_id": 1002,
                    "category": "FIRE",
                    "severity": 3,
                    "victim_count": 0,
                    "created_at_ms": 1699999950000,
                    "latitude": 26.278,
                    "longitude": 73.025
                }
            ],
            "resources": [
                {
                    "resource_id": 501,
                    "resource_type": "ALS_AMBULANCE",
                    "status": "AVAILABLE",
                    "latitude": 26.268,
                    "longitude": 73.010
                },
                {
                    "resource_id": 502,
                    "resource_type": "BLS_AMBULANCE",
                    "status": "AVAILABLE",
                    "latitude": 26.260,
                    "longitude": 73.012
                },
                {
                    "resource_id": 503,
                    "resource_type": "FIRE_ENGINE",
                    "status": "AVAILABLE",
                    "latitude": 26.280,
                    "longitude": 73.020
                }
            ],
            "hospitals": [
                {
                    "hospital_id": 701,
                    "name": "MDM Hospital Jodhpur",
                    "latitude": 26.273,
                    "longitude": 73.012,
                    "status": "NORMAL",
                    "available_general_beds": 20,
                    "available_icu_beds": 8,
                    "available_oxygen_beds": 10,
                    "capabilities": ["GENERAL_EMERGENCY", "TRAUMA_CENTER", "CARDIAC_CARE", "BURN_UNIT"]
                },
                {
                    "hospital_id": 702,
                    "name": "AIIMS Jodhpur",
                    "latitude": 26.248,
                    "longitude": 73.003,
                    "status": "NORMAL",
                    "available_general_beds": 50,
                    "available_icu_beds": 15,
                    "available_oxygen_beds": 25,
                    "capabilities": ["GENERAL_EMERGENCY", "TRAUMA_CENTER", "CARDIAC_CARE", "BURN_UNIT", "PEDIATRIC_CARE"]
                }
            ]
        }
    })";

    std::string output_json;
    int exit_code = runner.ExecuteJsonRequest(request_json, output_json);
    TEST_ASSERT(exit_code == ExitCode::SUCCESS, "Authentic execution must return code 0");

    nlohmann::json resp = nlohmann::json::parse(output_json);
    TEST_ASSERT(resp["status"] == "success", "Response status must be success");
    TEST_ASSERT(resp["request_id"] == "REQ-AUTH-JODHPUR-001", "Request ID mismatch");
    TEST_ASSERT(resp["data"]["batch_id"] == 9001, "Batch ID mismatch");
    TEST_ASSERT(resp["data"]["total_incidents_received"] == 2, "Incident count mismatch");
    TEST_ASSERT(resp["data"]["valid_incidents"] == 2, "All incidents must be valid");
    TEST_ASSERT(resp["data"]["incident_results"].size() == 2, "Must return 2 incident results");

    // Incident 1001 (Severity 5, Medical)
    const auto& res0 = resp["data"]["incident_results"][0];
    TEST_ASSERT(res0["incident_id"] == 1001, "Incident 1001 must be processed first");
    TEST_ASSERT(res0["resource_allocation"]["allocated_resources"].size() >= 1, "At least 1 resource allocated");
    TEST_ASSERT(res0["hospital_recommendation"]["status"] == "SUITABLE_HOSPITALS_FOUND", "Hospital matching status mismatch");
    TEST_ASSERT(res0["hospital_recommendation"]["recommended_hospital_id"] > 0, "Hospital ID must be valid");

    // Verify polyline route is present
    const auto& h_route = res0["hospital_recommendation"]["route_to_hospital"];
    TEST_ASSERT(!h_route["encoded_polyline"].get<std::string>().empty(), "Polyline must be non-empty");
    TEST_ASSERT(h_route["node_count"] > 0, "Node count must be > 0");
    TEST_ASSERT(h_route["distance_meters"] > 0.0, "Distance must be > 0");

    std::cout << "Test5_AuthenticJodhpurExecution passed. Batch execution completed in "
              << resp["telemetry"]["total_engine_time_ms"] << " ms." << std::endl;
    return true;
}

// ============================================================================
// 6. PROCESS CLI & PIPE STREAMS VERIFICATION
// ============================================================================

bool Test6_StreamInterface() {
    std::cout << "Running Test6_StreamInterface..." << std::endl;

    auto g = std::make_shared<Graph>(BuildSyntheticGraph());
    auto grid = std::make_shared<SpatialGrid>();
    grid->Build(*g, 250.0);

    EngineRunner runner(g, grid, nullptr);

    std::istringstream in_stream(R"({
        "protocol_version": "1.0",
        "request_id": "STREAM-01",
        "operation": "dispatch_batch",
        "payload": {
            "batch_id": 5,
            "evaluated_at_ms": 1000000,
            "incidents": [
                {
                    "incident_id": 77,
                    "category": "MEDICAL",
                    "severity": 3,
                    "created_at_ms": 990000,
                    "incident_node_osm_id": 20
                }
            ],
            "resources": [
                {
                    "resource_id": 88,
                    "resource_type": "BLS_AMBULANCE",
                    "status": "AVAILABLE",
                    "current_node_osm_id": 10
                }
            ],
            "hospitals": [
                {
                    "hospital_id": 99,
                    "name": "Stream Hospital",
                    "hospital_node_osm_id": 30,
                    "status": "NORMAL",
                    "available_general_beds": 5,
                    "capabilities": ["GENERAL_EMERGENCY", "TRAUMA"]
                }
            ]
        }
    })");

    std::ostringstream out_stream;
    int exit_code = runner.Run(in_stream, out_stream);
    TEST_ASSERT(exit_code == ExitCode::SUCCESS, "Run() must return exit code 0");

    std::string out_str = out_stream.str();
    TEST_ASSERT(!out_str.empty(), "Output stream must not be empty");

    nlohmann::json resp = nlohmann::json::parse(out_str);
    TEST_ASSERT(resp["status"] == "success", "Stream response status must be success");
    TEST_ASSERT(resp["request_id"] == "STREAM-01", "Request ID mismatch");

    std::cout << "Test6_StreamInterface passed." << std::endl;
    return true;
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

int main() {
    std::cout << "================================================================" << std::endl;
    std::cout << "   PHASE 3.12 JSON PROTOCOL & STDIN/STDOUT INTERFACE TESTS" << std::endl;
    std::cout << "================================================================" << std::endl;

    size_t tests_passed = 0;
    size_t total_tests = 6;

    if (Test1_EnvelopeValidation()) tests_passed++;
    if (Test2_PayloadValidation()) tests_passed++;
    if (Test3_SafeNumberAndSerialization()) tests_passed++;
    if (Test4_SyntheticEndToEnd()) tests_passed++;
    if (Test5_AuthenticJodhpurExecution()) tests_passed++;
    if (Test6_StreamInterface()) tests_passed++;

    std::cout << "================================================================" << std::endl;
    std::cout << "   TEST RESULTS: " << tests_passed << " / " << total_tests << " TEST SUITES PASSED" << std::endl;
    std::cout << "================================================================" << std::endl;

    return (tests_passed == total_tests) ? 0 : 1;
}

