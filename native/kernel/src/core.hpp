// ParaWerk geometry kernel core: plain C++ over Open CASCADE Technology.
//
// No Emscripten dependency, so the same code runs in the WebAssembly module
// (bindings.cpp), in native benchmarks (bench/native) and in native tests.
// Shapes are kept in an internal store and referenced by integer ids.

#pragma once

#include <cstdint>
#include <exception>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace parawerk {

/** A failure with a ParaWerk error code (see FeatureErrorCode in src/kernel/protocol.ts). */
struct KernelError : std::runtime_error {
  std::string code;
  KernelError(std::string errorCode, const std::string& message);
};

/** Kinds must match SurfaceKind / CurveKind in src/kernel/protocol.ts. */
enum SurfaceKind : uint8_t { Plane, Cylinder, Cone, Sphere, Torus, BSpline, Revolution, Extrusion, OtherSurface };
enum CurveKind : uint8_t { Line, Circle, Ellipse, BSplineCurve, OtherCurve };

struct Counts {
  int faces = 0;
  int edges = 0;
  int solids = 0;
};

struct BoundingBox {
  double min[3] = {0, 0, 0};
  double max[3] = {0, 0, 0};
};

struct MassProperties {
  double volume = 0;
  double area = 0;
  double center[3] = {0, 0, 0};
};

/** Everything the 3D view needs for one body. Face i / edge i follow TopExp::MapShapes order. */
struct MeshData {
  std::vector<float> positions;
  std::vector<float> normals;
  std::vector<uint32_t> indices;
  std::vector<uint32_t> faceRanges;  // [start, count] per face, in units of `indices`
  std::vector<float> edgePositions;  // segment pairs
  std::vector<uint32_t> edgeRanges;  // [start, count] per edge, in points of `edgePositions`
  std::vector<uint8_t> faceKinds;
  std::vector<double> faceAreas;
  std::vector<double> faceRadii;  // NaN when not applicable
  std::vector<uint8_t> edgeKinds;
  std::vector<double> edgeLengths;
  std::vector<double> edgeRadii;  // NaN when not applicable
};

int makeBox(double x, double y, double z, double dx, double dy, double dz);
int makeCylinder(double px, double py, double pz, double dx, double dy, double dz, double radius, double height);
/** op: 0 = fuse (add material), 1 = cut (remove material). */
int booleanOperation(int bodyId, int toolId, int op);
int fillet(int bodyId, const std::vector<int>& edgeIndices, double radius);
int chamfer(int bodyId, const std::vector<int>& edgeIndices, double distance);
void release(int id);
int shapeCount();

Counts counts(int id);
BoundingBox boundingBox(int id);
MassProperties massProperties(int id);
/** Display mesh with edges and exact face/edge geometry; keeps triangulations of unchanged faces. */
MeshData mesh(int id, double linear, double angular);
/** Fine faces-only mesh of a copy (for STL), so the display triangulation is not replaced. */
MeshData exportMesh(int id, double linear, double angular);
std::string exportStep(int id);
int importStep(const std::string& data);

/** Converts the current exception into an error code and message (call inside a catch block). */
std::pair<std::string, std::string> describeException(std::exception_ptr error);

}  // namespace parawerk
