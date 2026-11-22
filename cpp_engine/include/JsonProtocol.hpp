#pragma once

#include "json.hpp"
#include <string>
#include <vector>
#include <cstdint>

namespace EmergencyRouting {
namespace Protocol {

inline constexpr const char* CURRENT_PROTOCOL_VERSION = "1.0";
inline constexpr const char* OP_DISPATCH_BATCH = "dispatch_batch";

// Standardized error codes for machine-readable client responses
namespace ErrorCode {
    inline constexpr const char* EMPTY_INPUT                 = "EMPTY_INPUT";
    inline constexpr const char* INVALID_JSON                = "INVALID_JSON";
    inline constexpr const char* INVALID_PROTOCOL_VERSION    = "INVALID_PROTOCOL_VERSION";
    inline constexpr const char* INVALID_REQUEST             = "INVALID_REQUEST";
    inline constexpr const char* UNKNOWN_OPERATION           = "UNKNOWN_OPERATION";
    inline constexpr const char* INVALID_INCIDENT            = "INVALID_INCIDENT";
    inline constexpr const char* INVALID_RESOURCE            = "INVALID_RESOURCE";
    inline constexpr const char* INVALID_HOSPITAL            = "INVALID_HOSPITAL";
    inline constexpr const char* DATASET_LOAD_ERROR          = "DATASET_LOAD_ERROR";
    inline constexpr const char* ENGINE_INITIALIZATION_ERROR = "ENGINE_INITIALIZATION_ERROR";
    inline constexpr const char* ENGINE_EXECUTION_ERROR      = "ENGINE_EXECUTION_ERROR";
    inline constexpr const char* SERIALIZATION_ERROR         = "SERIALIZATION_ERROR";
    inline constexpr const char* INTERNAL_ERROR              = "INTERNAL_ERROR";
}

// Exit codes for process lifecycle management
namespace ExitCode {
    inline constexpr int SUCCESS                    = 0; // Request processed successfully
    inline constexpr int PROTOCOL_OR_REQUEST_ERROR  = 1; // Protocol mismatch, bad JSON, or schema error
    inline constexpr int INITIALIZATION_OR_DATA_ERR = 2; // Graph/GeoJSON missing or corrupt
    inline constexpr int EXECUTION_OR_INTERNAL_ERR  = 3; // Unhandled internal exception or fault
}

struct ProtocolErrorDetail {
    std::string field;
    std::string issue;
};

struct ProtocolError {
    std::string code{ErrorCode::INTERNAL_ERROR};
    std::string message;
    std::vector<ProtocolErrorDetail> details;

    nlohmann::json ToJson() const {
        nlohmann::json j;
        j["code"] = code;
        j["message"] = message;
        nlohmann::json d_arr = nlohmann::json::array();
        for (const auto& d : details) {
            d_arr.push_back({{"field", d.field}, {"issue", d.issue}});
        }
        j["details"] = d_arr;
        return j;
    }
};

struct RequestEnvelope {
    std::string protocol_version;
    std::string request_id{"UNKNOWN"};
    std::string operation;
    nlohmann::json payload;
};

} // namespace Protocol
} // namespace EmergencyRouting

