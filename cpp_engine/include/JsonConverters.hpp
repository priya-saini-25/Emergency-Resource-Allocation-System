#pragma once

#include "JsonProtocol.hpp"
#include "DispatchOrchestrator.hpp"
#include <string>
#include <vector>

namespace EmergencyRouting {
namespace Protocol {

// Helper to sanitize floating-point numbers so NaN and Infinity serialize as JSON null
inline nlohmann::json SafeNumber(double val) {
    if (!std::isfinite(val)) {
        return nullptr;
    }
    return val;
}

// String-to-Enum converters with strict validation
bool ParseEmergencyCategory(const nlohmann::json& j, Priority::EmergencyCategory& out, std::string& err);
bool ParseResourceType(const nlohmann::json& j, Allocation::ResourceType& out, std::string& err);
bool ParseAvailabilityStatus(const nlohmann::json& j, Allocation::AvailabilityStatus& out, std::string& err);
bool ParseHospitalStatus(const nlohmann::json& j, Hospital::HospitalStatus& out, std::string& err);
bool ParseHospitalCapability(const nlohmann::json& j, Hospital::HospitalCapability& out, std::string& err);

// Model parsers
bool ParseIncident(const nlohmann::json& j, size_t index, Orchestration::EmergencyIncident& out, std::vector<ProtocolErrorDetail>& errors);
bool ParseResource(const nlohmann::json& j, size_t index, Allocation::ResourceRecord& out, std::vector<ProtocolErrorDetail>& errors);
bool ParseHospital(const nlohmann::json& j, size_t index, Hospital::HospitalRecord& out, std::vector<ProtocolErrorDetail>& errors);

// Request envelope & payload parser
bool ParseBatchRequestPayload(const nlohmann::json& payload,
                              Orchestration::DispatchBatchRequest& out,
                              std::vector<ProtocolErrorDetail>& errors);

// Structured response serializers
nlohmann::json SerializeBatchResult(const Orchestration::DispatchBatchResult& res,
                                    const std::string& request_id,
                                    double process_time_ms);

nlohmann::json SerializeErrorResponse(const std::string& protocol_version,
                                      const std::string& request_id,
                                      const std::string& operation,
                                      const ProtocolError& error,
                                      double process_time_ms);

} // namespace Protocol
} // namespace EmergencyRouting

