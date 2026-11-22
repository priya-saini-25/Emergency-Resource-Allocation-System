#include "PolylineEncoder.hpp"
#include <cmath>
#include <stdexcept>
#include <cstdint>

namespace EmergencyRouting {

namespace {

inline void EncodeValue(int32_t val, std::string& out) {
    uint32_t b = (val < 0) ? ~(static_cast<uint32_t>(val) << 1) : (static_cast<uint32_t>(val) << 1);
    while (b >= 0x20) {
        out.push_back(static_cast<char>((b & 0x1F) | 0x20) + 63);
        b >>= 5;
    }
    out.push_back(static_cast<char>(b & 0x1F) + 63);
}

} // anonymous namespace

std::string PolylineEncoder::Encode(const std::vector<GeoPoint>& coords) {
    if (coords.empty()) {
        return "";
    }

    std::string result;
    result.reserve(coords.size() * 8);

    int32_t prev_lat = 0;
    int32_t prev_lon = 0;

    for (size_t i = 0; i < coords.size(); ++i) {
        const auto& pt = coords[i];

        if (!std::isfinite(pt.latitude) || !std::isfinite(pt.longitude)) {
            throw std::invalid_argument("PolylineEncoder Error: Non-finite coordinate at index " + std::to_string(i));
        }
        if (pt.latitude < -90.0 || pt.latitude > 90.0 || pt.longitude < -180.0 || pt.longitude > 180.0) {
            throw std::invalid_argument("PolylineEncoder Error: Coordinate out of bounds [-90, 90] / [-180, 180] at index " +
                                        std::to_string(i) + " (lat=" + std::to_string(pt.latitude) +
                                        ", lon=" + std::to_string(pt.longitude) + ")");
        }

        const int32_t curr_lat = static_cast<int32_t>(std::round(pt.latitude * PRECISION_SCALE));
        const int32_t curr_lon = static_cast<int32_t>(std::round(pt.longitude * PRECISION_SCALE));

        EncodeValue(curr_lat - prev_lat, result);
        EncodeValue(curr_lon - prev_lon, result);

        prev_lat = curr_lat;
        prev_lon = curr_lon;
    }

    return result;
}

std::vector<GeoPoint> PolylineEncoder::Decode(const std::string& encoded) {
    if (encoded.empty()) {
        return {};
    }

    std::vector<GeoPoint> points;
    size_t index = 0;
    int32_t lat = 0;
    int32_t lon = 0;
    const size_t len = encoded.length();

    while (index < len) {
        // Decode latitude delta
        int32_t shift = 0;
        int32_t result = 0;
        while (index < len) {
            char c = encoded[index++];
            if (c < 63 || c > 126) {
                throw std::invalid_argument("PolylineEncoder Error: Invalid character in polyline string at index " +
                                            std::to_string(index - 1) + ": ASCII " + std::to_string(static_cast<int>(c)));
            }
            int32_t b = c - 63;
            result |= (b & 0x1F) << shift;
            shift += 5;
            if (b < 0x20) break;
        }
        int32_t dlat = ((result & 1) != 0 ? ~(result >> 1) : (result >> 1));
        lat += dlat;

        // Verify that longitude component follows
        if (index >= len) {
            throw std::invalid_argument("PolylineEncoder Error: Truncated polyline string; missing longitude delta");
        }

        // Decode longitude delta
        shift = 0;
        result = 0;
        while (index < len) {
            char c = encoded[index++];
            if (c < 63 || c > 126) {
                throw std::invalid_argument("PolylineEncoder Error: Invalid character in polyline string at index " +
                                            std::to_string(index - 1) + ": ASCII " + std::to_string(static_cast<int>(c)));
            }
            int32_t b = c - 63;
            result |= (b & 0x1F) << shift;
            shift += 5;
            if (b < 0x20) break;
        }
        int32_t dlon = ((result & 1) != 0 ? ~(result >> 1) : (result >> 1));
        lon += dlon;

        points.push_back(GeoPoint{
            static_cast<double>(lat) * INV_PRECISION_SCALE,
            static_cast<double>(lon) * INV_PRECISION_SCALE
        });
    }

    return points;
}

} // namespace EmergencyRouting

