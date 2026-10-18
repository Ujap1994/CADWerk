// Native benchmark of the ParaWerk kernel core: the same cases as bench/kernel/run.ts,
// run against natively compiled OCCT, to measure the cost of WebAssembly.
// Build and run: bench/native/run.sh  (writes bench/results/kernel-native-<platform>-<arch>.json)

#include "../../native/kernel/src/core.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <functional>
#include <map>
#include <string>
#include <vector>

using namespace parawerk;

namespace {

double nowMs() {
  return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

struct Result {
  double median = 0, p95 = 0, min = 0;
  int iterations = 0;
};

Result measure(const std::function<void(int)>& fn, int iterations = 10, int warmup = 2) {
  for (int i = 0; i < warmup; ++i) fn(-1 - i);
  std::vector<double> samples;
  for (int i = 0; i < iterations; ++i) {
    const double start = nowMs();
    fn(i);
    samples.push_back(nowMs() - start);
  }
  std::sort(samples.begin(), samples.end());
  Result r;
  r.median = samples[samples.size() / 2];
  r.p95 = samples[std::min(samples.size() - 1, static_cast<size_t>(0.95 * samples.size()))];
  r.min = samples.front();
  r.iterations = iterations;
  return r;
}

double diagonal(int id) {
  const BoundingBox b = boundingBox(id);
  return std::hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
}

double clamp(double v, double lo, double hi) { return std::min(hi, std::max(lo, v)); }

/** Display mesh as the app requests it (see src/kernel/mesh-quality.ts). */
void displayMesh(int id) {
  const double d = diagonal(id);
  mesh(id, clamp(d * 5e-4, 0.002, 2), 0.2);
}

/** Plate with a grid of holes, one boolean per hole (like the feature list in the TS benchmark). */
std::vector<int> buildPlate(int holes, double width) {
  const int side = static_cast<int>(std::ceil(std::sqrt(holes)));
  const double pitch = 360.0 / side;
  std::vector<int> bodies;
  int body = makeBox(-width / 2, -200, 0, width, 400, 12);
  bodies.push_back(body);
  for (int i = 0; i < holes; ++i) {
    const double x = -180 + pitch / 2 + (i % side) * pitch;
    const double y = -180 + pitch / 2 + (i / side) * pitch;
    const int tool = makeCylinder(x, y, -4, 0, 0, 1, 4, 20);
    body = booleanOperation(body, tool, 1);
    release(tool);
    bodies.push_back(body);
  }
  return bodies;
}

void releaseAll(const std::vector<int>& ids) {
  for (const int id : ids) release(id);
}

}  // namespace

int main(int argc, char** argv) {
  const std::string output = argc > 1 ? argv[1] : "kernel-native.json";
  std::map<std::string, Result> cases;

  cases["box.rebuild"] = measure([](int i) {
    const int box = makeBox(-50, -30, 0, 100 + i, 60, 40);
    counts(box);
    displayMesh(box);
    release(box);
  }, 30);

  cases["fillet.12edges.rebuild"] = measure([](int i) {
    const int box = makeBox(-50, -30, 0, 100, 60, 40);
    const int filleted = fillet(box, {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11}, 3 + (std::abs(i) % 5) * 0.25);
    counts(filleted);
    displayMesh(filleted);
    release(filleted);
    release(box);
  }, 20);

  for (const int holes : {10, 50, 100}) {
    cases["plate." + std::to_string(holes) + "holes.fullRebuild"] = measure([holes](int i) {
      const std::vector<int> bodies = buildPlate(holes, 400 + (i + 3) * 0.01);
      displayMesh(bodies.back());
      releaseAll(bodies);
    }, holes >= 100 ? 3 : 5, 1);
  }

  // Edit the last of 101 features: only the last boolean and the mesh are recomputed.
  std::vector<int> big = buildPlate(99, 400);
  displayMesh(big.back());
  cases["plate.100holes.editLast"] = measure([&](int i) {
    const int tool = makeCylinder(162, 162, -4, 0, 0, 1, 3 + (std::abs(i) % 5) * 0.2, 20);
    const int body = booleanOperation(big.back(), tool, 1);
    release(tool);
    counts(body);
    displayMesh(body);
    release(body);
  }, 10);

  const int last = makeCylinder(162, 162, -4, 0, 0, 1, 4, 20);
  const int plate = booleanOperation(big.back(), last, 1);
  release(last);
  displayMesh(plate);
  cases["plate.100holes.mesh"] = measure([&](int) { displayMesh(plate); }, 10);
  cases["plate.100holes.massProperties"] = measure([&](int) { massProperties(plate); }, 10);
  cases["plate.100holes.exportStep"] = measure([&](int) { exportStep(plate); }, 5, 1);
  cases["plate.100holes.exportStl"] = measure([&](int) {
    const double d = diagonal(plate);
    exportMesh(plate, clamp(d * 1e-4, 0.001, 0.1), 0.15);
  }, 5, 1);

  FILE* file = std::fopen(output.c_str(), "w");
  if (!file) return 1;
  std::fprintf(file, "{\n  \"suite\": \"kernel-native\",\n  \"cases\": {\n");
  size_t n = 0;
  for (const auto& [name, r] : cases) {
    std::fprintf(file, "    \"%s\": { \"medianMs\": %.3f, \"p95Ms\": %.3f, \"minMs\": %.3f, \"iterations\": %d }%s\n",
                 name.c_str(), r.median, r.p95, r.min, r.iterations, ++n < cases.size() ? "," : "");
    std::printf("%-34s median %9.2f ms   min %9.2f ms\n", name.c_str(), r.median, r.min);
  }
  std::fprintf(file, "  }\n}\n");
  std::fclose(file);
  return 0;
}
