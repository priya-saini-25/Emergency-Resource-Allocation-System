#include "EngineRunner.hpp"
#include "DataLoader.hpp"

#include <fstream>
#include <sstream>
#include <chrono>
#include <algorithm>
#include <cctype>

namespace EmergencyRouting {

EngineRunner::EngineRunner() = default;

EngineRunner::EngineRunner(const std::string& data_dir)
    : data_dir_(data_dir) {}

EngineRunner::EngineRunner(std::shared_ptr<const Graph> graph,
                           std::shared_ptr<const SpatialGrid> spatial_grid,
                           std::shared_ptr<const BoundaryValidator> boundary_validator)
    : graph_(std::move(graph)),
      spatial_grid_(std::move(spatial_grid)),
      boundary_validator_(std::move(boundary_validator)) {
    if (graph_ && spatial_grid_) {
        orchestrator_ = std::make_unique<Orchestration::DispatchOrchestrator>(
            *graph_, *spatial_grid_, boundary_validator_.get());
        is_initialized_ = true;
    }
}

void EngineRunner::SetDataDirectory(const std::string& data_dir) {
    data_dir_ = data_dir;
    // Reset initialization if data dir is changed
    is_initialized_ = false;
    orchestrator_.reset();
    graph_.reset();
    spatial_grid_.reset();
    boundary_validator_.reset();
}

bool EngineRunner::IsInitialized() const noexcept {
    return is_initialized_ && orchestrator_ != nullptr;
}

std::string EngineRunner::ResolveDataPath(const std::string& filename) const {
    if (!data_dir_.empty()) {
        std::vector<std::string> explicit_candidates = {
            data_dir_ + "/" + filename,
            data_dir_ + "\\" + filename
        };
        for (const auto& path : explicit_candidates) {
            std::ifstream f(path, std::ios::binary);
            if (f.good()) {
                return path;
            }
        }
        return ""; // Explicit data_dir was specified but file not found
    }

    std::vector<std::string> candidates = {
        "data/" + filename,
        "../data/" + filename,
        "../../data/" + filename,
        "cpp_engine/data/" + filename,
        "../cpp_engine/data/" + filename,
        "../../cpp_engine/data/" + filename
    };

    for (const auto& path : candidates) {
        std::ifstream f(path, std::ios::binary);
        if (f.good()) {
            return path;
        }
    }
    return "";
}

bool EngineRunner::Initialize() {
    if (IsInitialized()) {
        return true;
    }

    std::cerr << "[ENGINE_RUNNER] Initializing C++ Decision Engine..." << std::endl;

    std::string boundary_path = ResolveDataPath("jodhpur_boundary.geojson");
    if (boundary_path.empty()) {
        init_error_message_ = "Failed to locate 'jodhpur_boundary.geojson'. Check --data-dir or execution working directory.";
        std::cerr << "[ENGINE_RUNNER_ERROR] " << init_error_message_ << std::endl;
        return false;
    }

    std::string graph_path = ResolveDataPath("jodhpur_graph.json");
    if (graph_path.empty()) {
        init_error_message_ = "Failed to locate 'jodhpur_graph.json'. Check --data-dir or execution working directory.";
        std::cerr << "[ENGINE_RUNNER_ERROR] " << init_error_message_ << std::endl;
        return false;
    }

    try {
        std::cerr << "[ENGINE_RUNNER] Loading boundary polygon from " << boundary_path << "..." << std::endl;
        auto bv = std::make_shared<BoundaryValidator>();
        bv->LoadFromFile(boundary_path);
        boundary_validator_ = bv;

        std::cerr << "[ENGINE_RUNNER] Loading road network graph from " << graph_path << "..." << std::endl;
        auto g = std::make_shared<Graph>();
        auto stats = DataLoader::LoadFromJsonFile(graph_path, *g);
        std::cerr << "[ENGINE_RUNNER] Graph loaded: " << stats.nodes_loaded << " nodes, "
                  << stats.edges_loaded << " edges in " << stats.load_time_ms << " ms." << std::endl;
        graph_ = g;

        std::cerr << "[ENGINE_RUNNER] Building spatial indexing grid (250m cell size)..." << std::endl;
        auto grid = std::make_shared<SpatialGrid>();
        grid->Build(*graph_, 250.0);
        spatial_grid_ = grid;

        std::cerr << "[ENGINE_RUNNER] Instantiating DispatchOrchestrator..." << std::endl;
        orchestrator_ = std::make_unique<Orchestration::DispatchOrchestrator>(
            *graph_, *spatial_grid_, boundary_validator_.get());

        is_initialized_ = true;
        init_error_message_.clear();
        std::cerr << "[ENGINE_RUNNER] Engine initialization completed successfully." << std::endl;
        return true;
    } catch (const std::exception& ex) {
        init_error_message_ = std::string("Exception during engine initialization: ") + ex.what();
        std::cerr << "[ENGINE_RUNNER_ERROR] " << init_error_message_ << std::endl;
        is_initialized_ = false;
        orchestrator_.reset();
        graph_.reset();
        spatial_grid_.reset();
        boundary_validator_.reset();
        return false;
    }
}

int EngineRunner::ExecuteJsonRequest(const std::string& input_json, std::string& output_json) {
    auto t_start = std::chrono::high_resolution_clock::now();

    auto get_elapsed_ms = [&t_start]() -> double {
        auto t_now = std::chrono::high_resolution_clock::now();
        return std::chrono::duration<double, std::milli>(t_now - t_start).count();
    };

    // 1. Check for empty or whitespace-only input
    bool is_empty = true;
    for (char c : input_json) {
        if (!std::isspace(static_cast<unsigned char>(c))) {
            is_empty = false;
            break;
        }
    }

    if (is_empty) {
        Protocol::ProtocolError err;
        err.code = Protocol::ErrorCode::EMPTY_INPUT;
        err.message = "Received empty or whitespace-only input on stdin";
        output_json = Protocol::SerializeErrorResponse(
            "UNKNOWN", "UNKNOWN", "UNKNOWN", err, get_elapsed_ms()).dump(2);
        return Protocol::ExitCode::PROTOCOL_OR_REQUEST_ERROR;
    }

    // 2. Parse JSON syntax
    nlohmann::json root;
    try {
        root = nlohmann::json::parse(input_json);
    } catch (const nlohmann::json::parse_error& pe) {
        Protocol::ProtocolError err;
        err.code = Protocol::ErrorCode::INVALID_JSON;
        err.message = std::string("Malformed JSON syntax: ") + pe.what();
        output_json = Protocol::SerializeErrorResponse(
            "UNKNOWN", "UNKNOWN", "UNKNOWN", err, get_elapsed_ms()).dump(2);
        return Protocol::ExitCode::PROTOCOL_OR_REQUEST_ERROR;
    }

    // 3. Envelope structural validation
    if (!root.is_object()) {
        Protocol::ProtocolError err;
        err.code = Protocol::ErrorCode::INVALID_REQUEST;
        err.message = "Top-level JSON value must be an object envelope";
        output_json = Protocol::SerializeErrorResponse(
            "UNKNOWN", "UNKNOWN", "UNKNOWN", err, get_elapsed_ms()).dump(2);
        return Protocol::ExitCode::PROTOCOL_OR_REQUEST_ERROR;
    }

    // 3a. Validate request_id
    std::string request_id = "UNKNOWN";
    if (root.contains("request_id") && root["request_id"].is_string()) {
        request_id = root["request_id"].get<std::string>();
        if (request_id.empty()) {
            Protocol::ProtocolError err;
            err.code = Protocol::ErrorCode::INVALID_REQUEST;
            err.message = "Field 'request_id' must be a non-empty string";
            output_json = Protocol::SerializeErrorResponse(
                "UNKNOWN", "UNKNOWN", "UNKNOWN", err, get_elapsed_ms()).dump(2);
            return Protocol::ExitCode::PROTOCOL_OR_REQUEST_ERROR;
        }
    } else {
        Protocol::ProtocolError err;
        err.code = Protocol::ErrorCode::INVALID_REQUEST;
        err.message = "Field 'request_id' is required and must be a non-empty string";
        output_json = Protocol::SerializeErrorResponse(
            "UNKNOWN", "UNKNOWN", "UNKNOWN", err, get_elapsed_ms()).dump(2);
        return Protocol::ExitCode::PROTOCOL_OR_REQUEST_ERROR;
    }

    // 3b. Validate protocol_version
    std::string protocol_version = "UNKNOWN";
    if (root.contains("protocol_version") && root["protocol_version"].is_string()) {
        protocol_version = root["protocol_version"].get<std::string>();
        if (protocol_version != Protocol::CURRENT_PROTOCOL_VERSION) {
            Protocol::ProtocolError err;
            err.code = Protocol::ErrorCode::INVALID_PROTOCOL_VERSION;
            err.message = "Unsupported protocol_version '" + protocol_version + "'. Expected '" + Protocol::CURRENT_PROTOCOL_VERSION + "'";
            output_json = Protocol::SerializeErrorResponse(
                protocol_version, request_id, "UNKNOWN", err, get_elapsed_ms()).dump(2);
            return Protocol::ExitCode::PROTOCOL_OR_REQUEST_ERROR;
        }
    } else {
        Protocol::ProtocolError err;
        err.code = Protocol::ErrorCode::INVALID_REQUEST;
        err.message = "Field 'protocol_version' is required and must be a string";
        output_json = Protocol::SerializeErrorResponse(
            "UNKNOWN", request_id, "UNKNOWN", err, get_elapsed_ms()).dump(2);
        return Protocol::ExitCode::PROTOCOL_OR_REQUEST_ERROR;
    }

    // 3c. Validate operation
    std::string operation = "UNKNOWN";
    if (root.contains("operation") && root["operation"].is_string()) {
        operation = root["operation"].get<std::string>();
        if (operation != Protocol::OP_DISPATCH_BATCH) {
            Protocol::ProtocolError err;
            err.code = Protocol::ErrorCode::UNKNOWN_OPERATION;
            err.message = "Unsupported operation '" + operation + "'. Expected '" + Protocol::OP_DISPATCH_BATCH + "'";
            output_json = Protocol::SerializeErrorResponse(
                protocol_version, request_id, operation, err, get_elapsed_ms()).dump(2);
            return Protocol::ExitCode::PROTOCOL_OR_REQUEST_ERROR;
        }
    } else {
        Protocol::ProtocolError err;
        err.code = Protocol::ErrorCode::INVALID_REQUEST;
        err.message = "Field 'operation' is required and must be a string";
        output_json = Protocol::SerializeErrorResponse(
            protocol_version, request_id, "UNKNOWN", err, get_elapsed_ms()).dump(2);
        return Protocol::ExitCode::PROTOCOL_OR_REQUEST_ERROR;
    }

    // 3d. Validate payload existence
    if (!root.contains("payload") || !root["payload"].is_object()) {
        Protocol::ProtocolError err;
        err.code = Protocol::ErrorCode::INVALID_REQUEST;
        err.message = "Field 'payload' is required and must be an object";
        output_json = Protocol::SerializeErrorResponse(
            protocol_version, request_id, operation, err, get_elapsed_ms()).dump(2);
        return Protocol::ExitCode::PROTOCOL_OR_REQUEST_ERROR;
    }

    // 4. Parse payload contents
    Orchestration::DispatchBatchRequest batch_request;
    std::vector<Protocol::ProtocolErrorDetail> payload_errors;
    if (!Protocol::ParseBatchRequestPayload(root["payload"], batch_request, payload_errors)) {
        Protocol::ProtocolError err;
        err.code = Protocol::ErrorCode::INVALID_REQUEST;
        err.message = "Payload validation failed with " + std::to_string(payload_errors.size()) + " error(s)";
        err.details = payload_errors;
        output_json = Protocol::SerializeErrorResponse(
            protocol_version, request_id, operation, err, get_elapsed_ms()).dump(2);
        return Protocol::ExitCode::PROTOCOL_OR_REQUEST_ERROR;
    }

    // 5. Ensure engine is initialized
    if (!IsInitialized()) {
        if (!Initialize()) {
            Protocol::ProtocolError err;
            err.code = Protocol::ErrorCode::DATASET_LOAD_ERROR;
            err.message = init_error_message_.empty() ? "Engine initialization failed" : init_error_message_;
            output_json = Protocol::SerializeErrorResponse(
                protocol_version, request_id, operation, err, get_elapsed_ms()).dump(2);
            return Protocol::ExitCode::INITIALIZATION_OR_DATA_ERR;
        }
    }

    // 6. Execute batch dispatch recommendation
    try {
        auto batch_result = orchestrator_->ProcessBatch(batch_request);
        double total_ms = get_elapsed_ms();
        nlohmann::json response = Protocol::SerializeBatchResult(batch_result, request_id, total_ms);
        output_json = response.dump(2);
        return Protocol::ExitCode::SUCCESS;
    } catch (const std::exception& ex) {
        Protocol::ProtocolError err;
        err.code = Protocol::ErrorCode::ENGINE_EXECUTION_ERROR;
        err.message = std::string("Internal exception in dispatch engine: ") + ex.what();
        output_json = Protocol::SerializeErrorResponse(
            protocol_version, request_id, operation, err, get_elapsed_ms()).dump(2);
        return Protocol::ExitCode::EXECUTION_OR_INTERNAL_ERR;
    }
}

int EngineRunner::Run(std::istream& in, std::ostream& out) {
    std::string input((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    std::string output;
    int exit_code = ExecuteJsonRequest(input, output);
    out << output << std::endl;
    return exit_code;
}

} // namespace EmergencyRouting

