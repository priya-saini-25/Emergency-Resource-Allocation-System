#include <filesystem>
#include <iostream>
#include <optional>
#include <utility>

int main() {

  // Structured bindings
  std::pair<int, int> coordinates = {10, 20};
  auto [x, y] = coordinates;

  // Optional
  std::optional<int> value = 100;

  // Filesystem
  std::filesystem::path projectPath = ".";

  std::cout << "C++ Standard: " << __cplusplus << '\n';
  std::cout << "Coordinates: " << x << ", " << y << '\n';
  std::cout << "Optional: " << value.value() << '\n';
  std::cout << "Project Path: " << projectPath << '\n';

  return 0;
}