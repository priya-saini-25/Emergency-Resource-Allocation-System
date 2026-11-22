#pragma once

#include "Graph.hpp"
#include "SpatialGrid.hpp"
#include "BoundaryValidator.hpp"
#include "DispatchOrchestrator.hpp"
#include "JsonProtocol.hpp"
#include "JsonConverters.hpp"

#include <string>
#include <memory>
#include <iostream>

namespace EmergencyRouting {

/**
 * High-Level Lifecycle and Execution Runner for the C++ Decision Engine.
 * Manages dataset loading, engine lifecycle, request validation, batch dispatch execution,
 * and stdout/stderr separation.
 */
class EngineRunner {
public:
    EngineRunner();
    explicit EngineRunner(const std::string& data_dir);

    /**
     * Dependency-injection constructor for testing without file I/O.
     */
    EngineRunner(std::shared_ptr<const Graph> graph,
                 std::shared_ptr<const SpatialGrid> spatial_grid,
                 std::shared_ptr<const BoundaryValidator> boundary_validator);

    ~EngineRunner() = default;

    /**
     * Set path to directory containing canonical data files (jodhpur_graph.json, jodhpur_boundary.geojson).
     */
    void SetDataDirectory(const std::string& data_dir);

    /**
     * Returns configured data directory.
     */
    const std::string& GetDataDirectory() const noexcept { return data_dir_; }

    /**
     * Initialize datasets and decision orchestrator.
     * Thread-safe or idempotent. Diagnostic traces are written strictly to std::cerr.
     * Returns true on success; false if datasets cannot be found, loaded, or parsed.
     */
    bool Initialize();

    /**
     * Check if the engine datasets and orchestrator have been successfully initialized.
     */
    bool IsInitialized() const noexcept;

    /**
     * Get error message if initialization failed.
     */
    const std::string& GetInitErrorMessage() const noexcept { return init_error_message_; }

    /**
     * Execute a single JSON request string, writing the structured JSON response to output_json.
     * Returns the appropriate process exit code:
     *   - ExitCode::SUCCESS (0) on successful processing
     *   - ExitCode::PROTOCOL_OR_REQUEST_ERROR (1) on malformed JSON, protocol version mismatch, or validation errors
     *   - ExitCode::INITIALIZATION_OR_DATA_ERR (2) on dataset missing or engine initialization failure
     *   - ExitCode::EXECUTION_OR_INTERNAL_ERR (3) on unhandled runtime exceptions
     */
    int ExecuteJsonRequest(const std::string& input_json, std::string& output_json);

    /**
     * Stream interface reading complete JSON request from input stream and writing JSON response to output stream.
     */
    int Run(std::istream& in = std::cin, std::ostream& out = std::cout);

    /**
     * Get reference to underlying orchestrator (nullptr if uninitialized).
     */
    const Orchestration::DispatchOrchestrator* GetOrchestrator() const noexcept {
        return orchestrator_.get();
    }

private:
    std::string ResolveDataPath(const std::string& filename) const;

    std::string data_dir_;
    bool is_initialized_{false};
    std::string init_error_message_;

    std::shared_ptr<const Graph> graph_;
    std::shared_ptr<const SpatialGrid> spatial_grid_;
    std::shared_ptr<const BoundaryValidator> boundary_validator_;
    std::unique_ptr<Orchestration::DispatchOrchestrator> orchestrator_;
};

} // namespace EmergencyRouting

