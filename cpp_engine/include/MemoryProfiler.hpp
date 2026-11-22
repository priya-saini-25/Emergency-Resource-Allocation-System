#pragma once

#include <cstddef>
#include <string>
#include <sstream>
#include <iomanip>

#ifdef _WIN32
#include <windows.h>
#include <psapi.h>
#else
#include <sys/resource.h>
#include <unistd.h>
#endif

namespace EmergencyRouting {

/**
 * Snapshot of resident process memory metrics.
 */
struct ProcessMemorySnapshot {
    size_t working_set_bytes{0};
    size_t peak_working_set_bytes{0};
    size_t private_bytes{0};

    double WorkingSetMb() const noexcept {
        return static_cast<double>(working_set_bytes) / (1024.0 * 1024.0);
    }
    double PeakWorkingSetMb() const noexcept {
        return static_cast<double>(peak_working_set_bytes) / (1024.0 * 1024.0);
    }
    double PrivateMb() const noexcept {
        return static_cast<double>(private_bytes) / (1024.0 * 1024.0);
    }
};

/**
 * Utility to capture process memory metrics on Windows (via PSAPI) and POSIX.
 */
class MemoryProfiler {
public:
    static ProcessMemorySnapshot Capture() {
        ProcessMemorySnapshot snapshot;
#ifdef _WIN32
        PROCESS_MEMORY_COUNTERS_EX pmc;
        if (GetProcessMemoryInfo(GetCurrentProcess(), reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&pmc), sizeof(pmc))) {
            snapshot.working_set_bytes = pmc.WorkingSetSize;
            snapshot.peak_working_set_bytes = pmc.PeakWorkingSetSize;
            snapshot.private_bytes = pmc.PrivateUsage;
        }
#else
        struct rusage usage;
        if (getrusage(RUSAGE_SELF, &usage) == 0) {
            snapshot.peak_working_set_bytes = static_cast<size_t>(usage.ru_maxrss) * 1024;
            snapshot.working_set_bytes = snapshot.peak_working_set_bytes;
            snapshot.private_bytes = snapshot.working_set_bytes;
        }
#endif
        return snapshot;
    }

    static std::string FormatBytes(size_t bytes) {
        std::ostringstream oss;
        oss << std::fixed << std::setprecision(2);
        if (bytes >= 1024ULL * 1024 * 1024) {
            oss << (static_cast<double>(bytes) / (1024.0 * 1024.0 * 1024.0)) << " GB";
        } else if (bytes >= 1024ULL * 1024) {
            oss << (static_cast<double>(bytes) / (1024.0 * 1024.0)) << " MB";
        } else if (bytes >= 1024ULL) {
            oss << (static_cast<double>(bytes) / 1024.0) << " KB";
        } else {
            oss << bytes << " Bytes";
        }
        return oss.str();
    }
};

} // namespace EmergencyRouting
