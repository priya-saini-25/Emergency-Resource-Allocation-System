#include "EngineRunner.hpp"
#include "JsonProtocol.hpp"
#include <iostream>
#include <string>

/**
 * Emergency Resource Allocation & Response Management System
 * Core Algorithmic Engine - Production JSON stdin/stdout Interface
 *
 * Exposes the multi-incident dispatch decision engine via stdin/stdout JSON protocol.
 * All structured JSON responses are written exclusively to stdout.
 * All diagnostic logs and telemetry are written strictly to stderr.
 */
int main(int argc, char* argv[]) {
    std::string data_dir;

    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--help" || arg == "-h") {
            std::cout << "Emergency Resource Allocation System - C++ Decision Engine\n"
                      << "Usage:\n"
                      << "  engine [OPTIONS] < request.json > response.json\n\n"
                      << "Options:\n"
                      << "  -d, --data-dir <DIR>   Set path to directory containing jodhpur_graph.json\n"
                      << "                         and jodhpur_boundary.geojson\n"
                      << "  -v, --version          Display protocol version and engine build info\n"
                      << "  -h, --help             Display this help message\n\n"
                      << "Standard Exit Codes:\n"
                      << "  0 : Success\n"
                      << "  1 : Protocol or request validation error\n"
                      << "  2 : Dataset loading or engine initialization error\n"
                      << "  3 : Internal execution error\n";
            return 0;
        } else if (arg == "--version" || arg == "-v") {
            std::cout << "{\n"
                      << "  \"engine\": \"Jodhpur Emergency Dispatch Engine\",\n"
                      << "  \"protocol_version\": \"" << EmergencyRouting::Protocol::CURRENT_PROTOCOL_VERSION << "\",\n"
                      << "  \"supported_operations\": [\"" << EmergencyRouting::Protocol::OP_DISPATCH_BATCH << "\"],\n"
                      << "  \"cpp_standard\": " << __cplusplus << "\n"
                      << "}\n";
            return 0;
        } else if ((arg == "--data-dir" || arg == "-d") && (i + 1 < argc)) {
            data_dir = argv[++i];
        } else {
            std::cerr << "[ENGINE_ERROR] Unknown argument: " << arg << "\n"
                      << "Run with --help for available options." << std::endl;
            return EmergencyRouting::Protocol::ExitCode::PROTOCOL_OR_REQUEST_ERROR;
        }
    }

    EmergencyRouting::EngineRunner runner;
    if (!data_dir.empty()) {
        runner.SetDataDirectory(data_dir);
    }

    return runner.Run(std::cin, std::cout);
}
