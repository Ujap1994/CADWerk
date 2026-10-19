// WebAssembly bindings of the ParaWerk kernel core (embind).
//
// JavaScript never owns C++ objects: shapes are integer ids, results are plain
// objects and copies of typed arrays, and every exception becomes an error object
// ({ ok: false, code, message }) instead of crossing into JavaScript.

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include "core.hpp"

using emscripten::val;

namespace {

template <typename T>
val typedArray(const char* type, const std::vector<T>& data) {
  // Copy into a JavaScript-owned typed array; WebAssembly memory may move later.
  return val::global(type).new_(val(emscripten::typed_memory_view(data.size(), data.data())));
}

val okObject() {
  val result = val::object();
  result.set("ok", true);
  return result;
}

val idResult(int id) {
  val result = okObject();
  result.set("id", id);
  return result;
}

template <typename Body>
val guarded(Body&& body) {
  try {
    return body();
  } catch (...) {
    const auto [code, message] = parawerk::describeException(std::current_exception());
    val result = val::object();
    result.set("ok", false);
    result.set("code", code);
    result.set("message", message);
    return result;
  }
}

std::vector<int> toIntVector(const val& array) {
  const int length = array["length"].as<int>();
  std::vector<int> result(static_cast<size_t>(length));
  for (int i = 0; i < length; ++i) result[static_cast<size_t>(i)] = array[i].as<int>();
  return result;
}

val point(const double (&p)[3]) { return val::array(std::vector<double>{p[0], p[1], p[2]}); }

val meshResult(const parawerk::MeshData& mesh) {
  val result = okObject();
  result.set("positions", typedArray("Float32Array", mesh.positions));
  result.set("normals", typedArray("Float32Array", mesh.normals));
  result.set("indices", typedArray("Uint32Array", mesh.indices));
  result.set("faceRanges", typedArray("Uint32Array", mesh.faceRanges));
  result.set("edgePositions", typedArray("Float32Array", mesh.edgePositions));
  result.set("edgeRanges", typedArray("Uint32Array", mesh.edgeRanges));
  result.set("faceKinds", typedArray("Uint8Array", mesh.faceKinds));
  result.set("faceAreas", typedArray("Float64Array", mesh.faceAreas));
  result.set("faceRadii", typedArray("Float64Array", mesh.faceRadii));
  result.set("facePlanes", typedArray("Float64Array", mesh.facePlanes));
  result.set("edgeKinds", typedArray("Uint8Array", mesh.edgeKinds));
  result.set("edgeLengths", typedArray("Float64Array", mesh.edgeLengths));
  result.set("edgeRadii", typedArray("Float64Array", mesh.edgeRadii));
  return result;
}

val makeBox(double x, double y, double z, double dx, double dy, double dz) {
  return guarded([&] { return idResult(parawerk::makeBox(x, y, z, dx, dy, dz)); });
}

val makeCylinder(double px, double py, double pz, double dx, double dy, double dz, double radius, double height) {
  return guarded([&] { return idResult(parawerk::makeCylinder(px, py, pz, dx, dy, dz, radius, height)); });
}

val booleanOperation(int bodyId, int toolId, int op) {
  return guarded([&] { return idResult(parawerk::booleanOperation(bodyId, toolId, op)); });
}

val fillet(int bodyId, val edgeIndices, double radius) {
  return guarded([&] { return idResult(parawerk::fillet(bodyId, toIntVector(edgeIndices), radius)); });
}

val chamfer(int bodyId, val edgeIndices, double distance) {
  return guarded([&] { return idResult(parawerk::chamfer(bodyId, toIntVector(edgeIndices), distance)); });
}

val counts(int id) {
  return guarded([&] {
    const parawerk::Counts counts = parawerk::counts(id);
    val result = okObject();
    result.set("faces", counts.faces);
    result.set("edges", counts.edges);
    result.set("solids", counts.solids);
    return result;
  });
}

val boundingBox(int id) {
  return guarded([&] {
    const parawerk::BoundingBox box = parawerk::boundingBox(id);
    val result = okObject();
    result.set("min", point(box.min));
    result.set("max", point(box.max));
    return result;
  });
}

val massProperties(int id) {
  return guarded([&] {
    const parawerk::MassProperties props = parawerk::massProperties(id);
    val result = okObject();
    result.set("volume", props.volume);
    result.set("area", props.area);
    result.set("center", point(props.center));
    return result;
  });
}

val mesh(int id, double linear, double angular) {
  return guarded([&] { return meshResult(parawerk::mesh(id, linear, angular)); });
}

val exportMesh(int id, double linear, double angular) {
  return guarded([&] { return meshResult(parawerk::exportMesh(id, linear, angular)); });
}

val exportStep(int id) {
  return guarded([&] {
    const std::string text = parawerk::exportStep(id);
    val result = okObject();
    result.set("data", val::global("Uint8Array").new_(val(emscripten::typed_memory_view(text.size(), reinterpret_cast<const uint8_t*>(text.data())))));
    return result;
  });
}

val importStep(val bytes) {
  return guarded([&] {
    const std::vector<uint8_t> data = emscripten::convertJSArrayToNumberVector<uint8_t>(bytes);
    return idResult(parawerk::importStep(std::string(data.begin(), data.end())));
  });
}

std::string version() { return "parawerk-kernel 0.2 / OCCT " PARAWERK_OCCT_VERSION; }

}  // namespace

EMSCRIPTEN_BINDINGS(parawerk_kernel) {
  emscripten::function("version", &version);
  emscripten::function("makeBox", &makeBox);
  emscripten::function("makeCylinder", &makeCylinder);
  emscripten::function("booleanOperation", &booleanOperation);
  emscripten::function("fillet", &fillet);
  emscripten::function("chamfer", &chamfer);
  emscripten::function("release", &parawerk::release);
  emscripten::function("shapeCount", &parawerk::shapeCount);
  emscripten::function("counts", &counts);
  emscripten::function("boundingBox", &boundingBox);
  emscripten::function("massProperties", &massProperties);
  emscripten::function("mesh", &mesh);
  emscripten::function("exportMesh", &exportMesh);
  emscripten::function("exportStep", &exportStep);
  emscripten::function("importStep", &importStep);
}
