# Environment Setup & C++ Toolchain Specification
## Emergency Resource Allocation & Response Management System

---

### 1. Executive Summary & Status
The C++ algorithmic core requires a modern 64-bit toolchain supporting **finalized C++17** (`__cplusplus = 201703L`). The legacy 32-bit MinGW 6.3.0 compiler (`C:\MinGW\bin\g++.exe`), which only offered draft C++1z (`201500L`), has been superseded by **MSYS2 UCRT64** while preserving the legacy compiler intact.

---

### 2. Verified Active Toolchain

| Tool / Component | Specification | Binary Path | Verification Status |
| :--- | :--- | :--- | :--- |
| **C++ Compiler** | GCC 16.2.0 (x86_64, UCRT) | `C:\msys64\ucrt64\bin\g++.exe` | Verified (`__cplusplus = 201703L`) |
| **C Compiler** | GCC 16.2.0 (x86_64, UCRT) | `C:\msys64\ucrt64\bin\gcc.exe` | Verified |
| **Build Generator** | CMake 4.4.5 (Kitware) | `C:\msys64\ucrt64\bin\cmake.exe` | Verified |
| **Build Automation** | GNU Make 4.4.1 (`mingw32-make`) | `C:\msys64\ucrt64\bin\mingw32-make.exe` | Verified |
| **Legacy Compiler** | MinGW.org GCC 6.3.0 (32-bit) | `C:\MinGW\bin\g++.exe` | **Preserved (Not modified/deleted)** |

---

### 3. C++17 Feature Verification Evidence

A standalone diagnostic program (`cpp_engine/compiler_test.cpp`) was compiled and executed with strict flags:
```bash
g++ -std=c++17 -Wall -Wextra -pedantic compiler_test.cpp -o compiler_test.exe
```

#### Code Verified:
- **C++ Standard Macro**: Verified `__cplusplus == 201703L` (Finalized C++17).
- **Structured Bindings**: `auto [x, y] = coordinates;` compiled and decomposed `std::pair<int, int>` cleanly.
- **Vocabulary Types**: `std::optional<int> value = 100;` instantiated and accessed.
- **Filesystem Library**: `std::filesystem::path projectPath = ".";` linked without requiring external `-lstdc++fs`.

#### Execution Output:
```text
C++ Standard: 201703
Coordinates: 10, 20
Optional: 100
Project Path: "."
```

---

### 4. Coexistence Strategy & DLL Resolution Safeguards

#### The Problem:
`C:\MinGW\bin` remains present in the system `PATH`. On Windows, if a 64-bit UCRT64 process (`g++.exe` or `cmake.exe`) attempts to locate shared dependencies (such as `libwinpthread-1.dll` or `libstdc++-6.dll`), having `C:\MinGW\bin` earlier in the search order causes dynamic linker errors or silent fallback to incompatible 32-bit binaries.

#### The Solution:
1. **Prepend UCRT64 to PATH for Builds**:
   Whenever executing CMake or Make commands from PowerShell, prepend `C:\msys64\ucrt64\bin`:
   ```powershell
   $env:PATH = "C:\msys64\ucrt64\bin;" + $env:PATH
   ```
2. **Deterministic CMake Invocation**:
   Specify compilers explicitly during generation:
   ```powershell
   cmake -B cpp_engine/build -S cpp_engine -G "MinGW Makefiles" `
     -DCMAKE_CXX_COMPILER="C:/msys64/ucrt64/bin/g++.exe" `
     -DCMAKE_C_COMPILER="C:/msys64/ucrt64/bin/gcc.exe" `
     -DCMAKE_MAKE_PROGRAM="C:/msys64/ucrt64/bin/mingw32-make.exe"
   ```
3. **Workspace Editor Integration (`.vscode/settings.json`)**:
   Configure CMake Tools to lock to the UCRT64 kit without touching global system variables:
   ```json
   {
     "cmake.cmakePath": "C:/msys64/ucrt64/bin/cmake.exe",
     "cmake.generator": "MinGW Makefiles",
     "cmake.environment": {
       "PATH": "C:\\msys64\\ucrt64\\bin;${env:PATH}"
     }
   }
   ```

---

### 5. CMake Configuration Verification

The existing `cpp_engine/CMakeLists.txt` was inspected:
```cmake
cmake_minimum_required(VERSION 3.10)
project(JodhpurEmergencyEngine VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

include_directories(${CMAKE_CURRENT_SOURCE_DIR}/include)
set(SOURCES src/main.cpp)
add_executable(engine ${SOURCES})
set_target_properties(engine PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/bin
)
```

#### Test Build Execution:
- Generation completed with `GNU 16.2.0` compiler identification.
- `engine.exe` was built in `cpp_engine/bin/engine.exe`.
- Executed `engine.exe`, producing:
  ```json
  {
    "status": "INITIALIZED",
    "engine": "Jodhpur Emergency Dispatch Engine",
    "version": "1.0.0-phase1",
    "cpp_standard": 201703
  }
  ```
- **Conclusion**: C++17 build environment is fully operational and verified.

