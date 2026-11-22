#pragma once

#include "GraphTypes.hpp"
#include <string>
#include <vector>

namespace EmergencyRouting {

/**
 * Standard Google Encoded Polyline algorithm (Precision 5, 1e5).
 * Encodes sequences of latitude/longitude coordinates into compact ASCII strings.
 *
 * Quantization:
 * Coordinates are scaled by 10^5 and rounded to the nearest integer.
 * Precision-5 quantization tolerance: ~1e-5 degrees (~1.1 meters).
 */
class PolylineEncoder {
public:
    static constexpr double PRECISION_SCALE = 1e5;
    static constexpr double INV_PRECISION_SCALE = 1e-5;

    /**
     * Encode a sequence of geographic coordinates into a standard Google Polyline string.
     *
     * @param coords Vector of GeoPoints [latitude, longitude].
     * @return Compact encoded ASCII polyline string. Empty string if input is empty.
     * @throws std::invalid_argument if any coordinate is non-finite or out of geographic bounds.
     */
    static std::string Encode(const std::vector<GeoPoint>& coords);

    /**
     * Decode a standard Google Polyline string back into geographic coordinates.
     *
     * @param encoded Encoded ASCII polyline string.
     * @return Vector of GeoPoints [latitude, longitude]. Empty vector if input is empty.
     * @throws std::invalid_argument if the encoded string is malformed or truncated.
     */
    static std::vector<GeoPoint> Decode(const std::string& encoded);
};

} // namespace EmergencyRouting

