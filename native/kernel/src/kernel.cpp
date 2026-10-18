// ParaWerk geometry kernel: a thin C++ facade over Open CASCADE Technology,
// compiled to WebAssembly with Emscripten.
//
// Design (docs/adr/0001-geometry-kernel.md):
// - Shapes live only in C++ and are referenced from JavaScript by integer ids.
//   JavaScript never owns C++ objects, so no embind object can leak.
// - Every entry point returns plain data (numbers, objects, typed-array copies).
// - OCCT failures are caught here and returned as error codes; no C++ exception
//   crosses into JavaScript.

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepGProp.hxx>
#include <BRepLib_ToolTriangulatedShape.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GCPnts_TangentialDeflection.hxx>
#include <GProp_GProps.hxx>
#include <IMeshTools_Parameters.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <Message_ProgressRange.hxx>
#include <NCollection_IndexedDataMap.hxx>
#include <NCollection_IndexedMap.hxx>
#include <NCollection_List.hxx>
#include <Poly_PolygonOnTriangulation.hxx>
#include <Poly_Triangulation.hxx>
#include <STEPControl_Reader.hxx>
#include <STEPControl_Writer.hxx>
#include <Standard_Failure.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_ShapeMapHasher.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Sphere.hxx>

#include <cmath>
#include <cstdint>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

using emscripten::val;

namespace {

using ShapeMap = NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>;
using AncestorMap = NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher>;

// ------------------------------------------------------------------ errors

/** A failure with a ParaWerk error code (see FeatureErrorCode in src/kernel/protocol.ts). */
struct KernelError : std::runtime_error {
  std::string code;
  KernelError(std::string errorCode, const std::string& message) : std::runtime_error(message), code(std::move(errorCode)) {}
};

val failure(const std::string& code, const std::string& message) {
  val result = val::object();
  result.set("ok", false);
  result.set("code", code);
  result.set("message", message);
  return result;
}

val success(int id) {
  val result = val::object();
  result.set("ok", true);
  result.set("id", id);
  return result;
}

/** Runs `body` and converts every C++ or OCCT exception into an error object. */
template <typename Body>
val guarded(Body&& body) {
  try {
    return body();
  } catch (const KernelError& error) {
    return failure(error.code, error.what());
  } catch (const Standard_Failure& error) {
    const char* text = error.what();
    return failure("operation-failed", std::string("OCCT: ") + (text && *text ? text : "geometry error"));
  } catch (const std::exception& error) {
    return failure("operation-failed", error.what());
  } catch (...) {
    return failure("operation-failed", "unknown kernel error");
  }
}

// ------------------------------------------------------------------ shape store

class ShapeStore {
 public:
  int add(const TopoDS_Shape& shape) {
    const int id = next_++;
    shapes_.emplace(id, shape);
    return id;
  }

  const TopoDS_Shape& get(int id) const {
    const auto it = shapes_.find(id);
    if (it == shapes_.end()) throw KernelError("unknown", "unknown shape id " + std::to_string(id));
    return it->second;
  }

  void release(int id) { shapes_.erase(id); }
  int size() const { return static_cast<int>(shapes_.size()); }

 private:
  std::unordered_map<int, TopoDS_Shape> shapes_;
  int next_ = 1;
};

ShapeStore& store() {
  static ShapeStore instance;
  return instance;
}

// ------------------------------------------------------------------ helpers

int countSolids(const TopoDS_Shape& shape) {
  ShapeMap solids;
  TopExp::MapShapes(shape, TopAbs_SOLID, solids);
  return solids.Extent();
}

template <typename T>
val typedArray(const char* type, const std::vector<T>& data) {
  // Copy into a JavaScript-owned typed array; WebAssembly memory may move later.
  return val::global(type).new_(val(emscripten::typed_memory_view(data.size(), data.data())));
}

std::vector<int> toIntVector(const val& array) {
  const int length = array["length"].as<int>();
  std::vector<int> result(static_cast<size_t>(length));
  for (int i = 0; i < length; ++i) result[static_cast<size_t>(i)] = array[i].as<int>();
  return result;
}

// ------------------------------------------------------------------ features

val makeBox(double x, double y, double z, double dx, double dy, double dz) {
  return guarded([&] {
    BRepPrimAPI_MakeBox maker(gp_Pnt(x, y, z), dx, dy, dz);
    return success(store().add(maker.Shape()));
  });
}

val makeCylinder(double px, double py, double pz, double dx, double dy, double dz, double radius, double height) {
  return guarded([&] {
    BRepPrimAPI_MakeCylinder maker(gp_Ax2(gp_Pnt(px, py, pz), gp_Dir(dx, dy, dz)), radius, height);
    return success(store().add(maker.Shape()));
  });
}

/** op: 0 = fuse (add material), 1 = cut (remove material). */
val booleanOperation(int bodyId, int toolId, int op) {
  return guarded([&] {
    const TopoDS_Shape& body = store().get(bodyId);
    const TopoDS_Shape& tool = store().get(toolId);
    TopoDS_Shape result;
    if (op == 0) {
      BRepAlgoAPI_Fuse algorithm(body, tool);
      if (algorithm.HasErrors()) throw KernelError("operation-failed", "boolean operation failed");
      algorithm.SimplifyResult(true, true, 1e-6);
      result = algorithm.Shape();
    } else {
      BRepAlgoAPI_Cut algorithm(body, tool);
      if (algorithm.HasErrors()) throw KernelError("operation-failed", "boolean operation failed");
      algorithm.SimplifyResult(true, true, 1e-6);
      result = algorithm.Shape();
    }
    if (countSolids(result) == 0) throw KernelError("empty-result", "the operation removed the whole body");
    return success(store().add(result));
  });
}

std::vector<TopoDS_Edge> selectEdges(const TopoDS_Shape& body, const val& edgeIndices) {
  ShapeMap edges;
  TopExp::MapShapes(body, TopAbs_EDGE, edges);
  std::vector<TopoDS_Edge> selected;
  for (const int index : toIntVector(edgeIndices)) {
    if (index < 0 || index >= edges.Extent()) throw KernelError("edge-missing", "edge " + std::to_string(index) + " does not exist");
    selected.push_back(TopoDS::Edge(edges(index + 1)));
  }
  if (selected.empty()) throw KernelError("no-edges", "no edges selected");
  return selected;
}

void requireValidSolid(const TopoDS_Shape& result, const char* what) {
  if (countSolids(result) == 0) throw KernelError("operation-failed", std::string(what) + " result is not a solid");
  BRepCheck_Analyzer analyzer(result, false);
  if (!analyzer.IsValid()) throw KernelError("operation-failed", std::string(what) + " produced an invalid solid");
}

val fillet(int bodyId, val edgeIndices, double radius) {
  return guarded([&] {
    const TopoDS_Shape& body = store().get(bodyId);
    BRepFilletAPI_MakeFillet maker(body, ChFi3d_Rational);
    for (const TopoDS_Edge& edge : selectEdges(body, edgeIndices)) maker.Add(radius, edge);
    maker.Build();
    if (!maker.IsDone()) throw KernelError("operation-failed", "fillet could not be computed (radius too large?)");
    const TopoDS_Shape result = maker.Shape();
    requireValidSolid(result, "fillet");
    return success(store().add(result));
  });
}

val chamfer(int bodyId, val edgeIndices, double distance) {
  return guarded([&] {
    const TopoDS_Shape& body = store().get(bodyId);
    BRepFilletAPI_MakeChamfer maker(body);
    for (const TopoDS_Edge& edge : selectEdges(body, edgeIndices)) maker.Add(distance, edge);
    maker.Build();
    if (!maker.IsDone()) throw KernelError("operation-failed", "chamfer could not be computed (distance too large?)");
    const TopoDS_Shape result = maker.Shape();
    requireValidSolid(result, "chamfer");
    return success(store().add(result));
  });
}

void release(int id) { store().release(id); }

int shapeCount() { return store().size(); }

// ------------------------------------------------------------------ queries

val counts(int id) {
  return guarded([&] {
    const TopoDS_Shape& shape = store().get(id);
    ShapeMap faces, edges;
    TopExp::MapShapes(shape, TopAbs_FACE, faces);
    TopExp::MapShapes(shape, TopAbs_EDGE, edges);
    val result = val::object();
    result.set("ok", true);
    result.set("faces", faces.Extent());
    result.set("edges", edges.Extent());
    result.set("solids", countSolids(shape));
    return result;
  });
}

val boundingBox(int id) {
  return guarded([&] {
    Bnd_Box box;
    BRepBndLib::Add(store().get(id), box, false);
    val result = val::object();
    result.set("ok", true);
    if (box.IsVoid()) {
      result.set("min", val::array(std::vector<double>{0, 0, 0}));
      result.set("max", val::array(std::vector<double>{0, 0, 0}));
      return result;
    }
    const gp_Pnt min = box.CornerMin();
    const gp_Pnt max = box.CornerMax();
    result.set("min", val::array(std::vector<double>{min.X(), min.Y(), min.Z()}));
    result.set("max", val::array(std::vector<double>{max.X(), max.Y(), max.Z()}));
    return result;
  });
}

val massProperties(int id) {
  return guarded([&] {
    const TopoDS_Shape& shape = store().get(id);
    GProp_GProps volume;
    BRepGProp::VolumeProperties(shape, volume);
    GProp_GProps surface;
    BRepGProp::SurfaceProperties(shape, surface);
    const gp_Pnt center = volume.CentreOfMass();
    val result = val::object();
    result.set("ok", true);
    result.set("volume", volume.Mass());
    result.set("area", surface.Mass());
    result.set("center", val::array(std::vector<double>{center.X(), center.Y(), center.Z()}));
    return result;
  });
}

// ------------------------------------------------------------------ tessellation

// Kinds must match SurfaceKind / CurveKind in src/kernel/protocol.ts.
enum SurfaceKindCode : uint8_t { Plane, Cylinder, Cone, Sphere, Torus, BSpline, Revolution, Extrusion, OtherSurface };
enum CurveKindCode : uint8_t { Line, Circle, Ellipse, BSplineCurve, OtherCurve };

uint8_t surfaceKind(GeomAbs_SurfaceType type) {
  switch (type) {
    case GeomAbs_Plane: return Plane;
    case GeomAbs_Cylinder: return Cylinder;
    case GeomAbs_Cone: return Cone;
    case GeomAbs_Sphere: return Sphere;
    case GeomAbs_Torus: return Torus;
    case GeomAbs_BezierSurface:
    case GeomAbs_BSplineSurface: return BSpline;
    case GeomAbs_SurfaceOfRevolution: return Revolution;
    case GeomAbs_SurfaceOfExtrusion: return Extrusion;
    default: return OtherSurface;
  }
}

uint8_t curveKind(GeomAbs_CurveType type) {
  switch (type) {
    case GeomAbs_Line: return Line;
    case GeomAbs_Circle: return Circle;
    case GeomAbs_Ellipse: return Ellipse;
    case GeomAbs_BezierCurve:
    case GeomAbs_BSplineCurve: return BSplineCurve;
    default: return OtherCurve;
  }
}

/**
 * Triangulates a shape and extracts everything the 3D view needs, in one call.
 *
 * BRepMesh_IncrementalMesh only meshes faces without a sufficient triangulation, so
 * faces shared with an earlier result (unchanged by the last feature) are not meshed
 * again. Face and edge indices follow TopExp::MapShapes, like the feature references.
 */
/**
 * Triangulates faces that have no sufficient triangulation yet.
 *
 * The 3D view uses Delabella, a fast Delaunay triangulator that matters most for large
 * planar faces with many holes. For the very fine STL tolerance it is much slower than
 * the default Watson algorithm, so exports use Watson (measured, see docs/benchmarks).
 */
void triangulate(const TopoDS_Shape& shape, double linear, double angular, bool forDisplay) {
  IMeshTools_Parameters parameters;
  parameters.MeshAlgo = forDisplay ? IMeshTools_MeshAlgoType_Delabella : IMeshTools_MeshAlgoType_Watson;
  parameters.Deflection = linear;
  parameters.Angle = angular;
  parameters.Relative = false;
  parameters.InParallel = false;
  BRepMesh_IncrementalMesh mesher(shape, parameters);
}

val mesh(int id, double linear, double angular, bool withEdges) {
  return guarded([&] {
    const TopoDS_Shape& shape = store().get(id);
    // Display meshes include edges; the export mesh (withEdges = false) needs the robust algorithm.
    triangulate(shape, linear, angular, withEdges);

    ShapeMap faces;
    TopExp::MapShapes(shape, TopAbs_FACE, faces);

    std::vector<float> positions;
    std::vector<float> normals;
    std::vector<uint32_t> indices;
    std::vector<uint32_t> faceRanges;
    std::vector<uint8_t> faceKinds;
    std::vector<double> faceAreas;
    std::vector<double> faceRadii;
    faceRanges.reserve(static_cast<size_t>(faces.Extent()) * 2);

    for (int f = 1; f <= faces.Extent(); ++f) {
      const TopoDS_Face face = TopoDS::Face(faces(f));
      const uint32_t start = static_cast<uint32_t>(indices.size());
      TopLoc_Location location;
      const occ::handle<Poly_Triangulation>& triangulation = BRep_Tool::Triangulation(face, location);
      if (!triangulation.IsNull()) {
        if (!triangulation->HasNormals()) BRepLib_ToolTriangulatedShape::ComputeNormals(face, triangulation);
        const gp_Trsf transform = location.Transformation();
        const bool reversed = face.Orientation() == TopAbs_REVERSED;
        const uint32_t base = static_cast<uint32_t>(positions.size() / 3);
        for (int n = 1; n <= triangulation->NbNodes(); ++n) {
          const gp_Pnt point = triangulation->Node(n).Transformed(transform);
          positions.push_back(static_cast<float>(point.X()));
          positions.push_back(static_cast<float>(point.Y()));
          positions.push_back(static_cast<float>(point.Z()));
          gp_Dir normal = triangulation->Normal(n).Transformed(transform);
          if (reversed) normal.Reverse();
          normals.push_back(static_cast<float>(normal.X()));
          normals.push_back(static_cast<float>(normal.Y()));
          normals.push_back(static_cast<float>(normal.Z()));
        }
        for (int t = 1; t <= triangulation->NbTriangles(); ++t) {
          int a = 0, b = 0, c = 0;
          triangulation->Triangle(t).Get(a, b, c);
          if (reversed) std::swap(b, c);
          indices.push_back(base + static_cast<uint32_t>(a - 1));
          indices.push_back(base + static_cast<uint32_t>(b - 1));
          indices.push_back(base + static_cast<uint32_t>(c - 1));
        }
      }
      faceRanges.push_back(start);
      faceRanges.push_back(static_cast<uint32_t>(indices.size()) - start);

      if (withEdges) {
        BRepAdaptor_Surface surface(face, false);
        const uint8_t kind = surfaceKind(surface.GetType());
        GProp_GProps props;
        BRepGProp::SurfaceProperties(face, props);
        double radius = std::numeric_limits<double>::quiet_NaN();
        if (kind == Cylinder) radius = surface.Cylinder().Radius();
        else if (kind == Sphere) radius = surface.Sphere().Radius();
        faceKinds.push_back(kind);
        faceAreas.push_back(props.Mass());
        faceRadii.push_back(radius);
      }
    }

    val result = val::object();
    result.set("ok", true);
    result.set("positions", typedArray("Float32Array", positions));
    result.set("normals", typedArray("Float32Array", normals));
    result.set("indices", typedArray("Uint32Array", indices));
    result.set("faceRanges", typedArray("Uint32Array", faceRanges));

    std::vector<float> edgePositions;
    std::vector<uint32_t> edgeRanges;
    std::vector<uint8_t> edgeKinds;
    std::vector<double> edgeLengths;
    std::vector<double> edgeRadii;
    if (withEdges) {
      ShapeMap edges;
      TopExp::MapShapes(shape, TopAbs_EDGE, edges);
      AncestorMap edgeFaces;
      TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edgeFaces);

      for (int e = 1; e <= edges.Extent(); ++e) {
        const TopoDS_Edge edge = TopoDS::Edge(edges(e));
        const uint32_t start = static_cast<uint32_t>(edgePositions.size() / 3);
        const NCollection_List<TopoDS_Shape>* adjacent = edgeFaces.Seek(edge);

        // Seams (a closed surface meeting itself) and degenerated edges are not drawn.
        bool hidden = BRep_Tool::Degenerated(edge);
        if (!hidden && adjacent != nullptr) {
          for (const TopoDS_Shape& f : *adjacent) {
            if (BRep_Tool::IsClosed(edge, TopoDS::Face(f))) {
              hidden = true;
              break;
            }
          }
        }

        if (!hidden) {
          bool drawn = false;
          if (adjacent != nullptr) {
            for (const TopoDS_Shape& f : *adjacent) {
              TopLoc_Location location;
              const occ::handle<Poly_Triangulation>& triangulation = BRep_Tool::Triangulation(TopoDS::Face(f), location);
              if (triangulation.IsNull()) continue;
              const occ::handle<Poly_PolygonOnTriangulation>& polygon = BRep_Tool::PolygonOnTriangulation(edge, triangulation, location);
              if (polygon.IsNull()) continue;
              const gp_Trsf transform = location.Transformation();
              const NCollection_Array1<int>& nodes = polygon->Nodes();
              for (int k = nodes.Lower(); k < nodes.Upper(); ++k) {
                const gp_Pnt p = triangulation->Node(nodes(k)).Transformed(transform);
                const gp_Pnt q = triangulation->Node(nodes(k + 1)).Transformed(transform);
                for (const gp_Pnt& point : {p, q}) {
                  edgePositions.push_back(static_cast<float>(point.X()));
                  edgePositions.push_back(static_cast<float>(point.Y()));
                  edgePositions.push_back(static_cast<float>(point.Z()));
                }
              }
              drawn = true;
              break;
            }
          }
          if (!drawn) {
            // Free edges without a triangulated face: discretize the curve directly.
            BRepAdaptor_Curve curve(edge);
            GCPnts_TangentialDeflection discretizer(curve, angular, linear);
            for (int k = 1; k < discretizer.NbPoints(); ++k) {
              for (const gp_Pnt& point : {discretizer.Value(k), discretizer.Value(k + 1)}) {
                edgePositions.push_back(static_cast<float>(point.X()));
                edgePositions.push_back(static_cast<float>(point.Y()));
                edgePositions.push_back(static_cast<float>(point.Z()));
              }
            }
          }
        }
        edgeRanges.push_back(start);
        edgeRanges.push_back(static_cast<uint32_t>(edgePositions.size() / 3) - start);

        if (BRep_Tool::Degenerated(edge)) {
          edgeKinds.push_back(OtherCurve);
          edgeLengths.push_back(0);
          edgeRadii.push_back(std::numeric_limits<double>::quiet_NaN());
        } else {
          BRepAdaptor_Curve curve(edge);
          const uint8_t kind = curveKind(curve.GetType());
          GProp_GProps props;
          BRepGProp::LinearProperties(edge, props);
          edgeKinds.push_back(kind);
          edgeLengths.push_back(props.Mass());
          edgeRadii.push_back(kind == Circle ? curve.Circle().Radius() : std::numeric_limits<double>::quiet_NaN());
        }
      }
    }

    result.set("edgePositions", typedArray("Float32Array", edgePositions));
    result.set("edgeRanges", typedArray("Uint32Array", edgeRanges));
    result.set("faceKinds", typedArray("Uint8Array", faceKinds));
    result.set("faceAreas", typedArray("Float64Array", faceAreas));
    result.set("faceRadii", typedArray("Float64Array", faceRadii));
    result.set("edgeKinds", typedArray("Uint8Array", edgeKinds));
    result.set("edgeLengths", typedArray("Float64Array", edgeLengths));
    result.set("edgeRadii", typedArray("Float64Array", edgeRadii));
    return result;
  });
}

/**
 * Fine tessellation for STL export. Meshes a copy, so the finer triangulation does
 * not replace the lighter one used by the 3D view.
 */
val exportMesh(int id, double linear, double angular) {
  return guarded([&] {
    BRepBuilderAPI_Copy copier(store().get(id), true, false);
    const int copyId = store().add(copier.Shape());
    val result = mesh(copyId, linear, angular, false);
    store().release(copyId);
    return result;
  });
}

// ------------------------------------------------------------------ data exchange

val exportStep(int id) {
  return guarded([&] {
    STEPControl_Writer writer;
    if (writer.Transfer(store().get(id), STEPControl_AsIs) != IFSelect_RetDone) {
      throw KernelError("operation-failed", "STEP transfer failed");
    }
    std::ostringstream stream;
    if (writer.WriteStream(stream) != IFSelect_RetDone) throw KernelError("operation-failed", "STEP write failed");
    const std::string text = stream.str();
    val result = val::object();
    result.set("ok", true);
    result.set("data", val::global("Uint8Array").new_(val(emscripten::typed_memory_view(text.size(), reinterpret_cast<const uint8_t*>(text.data())))));
    return result;
  });
}

val importStep(val bytes) {
  return guarded([&] {
    const std::vector<uint8_t> data = emscripten::convertJSArrayToNumberVector<uint8_t>(bytes);
    std::istringstream stream(std::string(data.begin(), data.end()));
    STEPControl_Reader reader;
    if (reader.ReadStream("import.step", stream) != IFSelect_RetDone) throw KernelError("operation-failed", "the STEP file could not be read");
    if (reader.TransferRoots() == 0) throw KernelError("operation-failed", "the STEP file contains no shapes");
    return success(store().add(reader.OneShape()));
  });
}

std::string version() { return "parawerk-kernel 0.1 / OCCT " PARAWERK_OCCT_VERSION; }

}  // namespace

EMSCRIPTEN_BINDINGS(parawerk_kernel) {
  emscripten::function("version", &version);
  emscripten::function("makeBox", &makeBox);
  emscripten::function("makeCylinder", &makeCylinder);
  emscripten::function("booleanOperation", &booleanOperation);
  emscripten::function("fillet", &fillet);
  emscripten::function("chamfer", &chamfer);
  emscripten::function("release", &release);
  emscripten::function("shapeCount", &shapeCount);
  emscripten::function("counts", &counts);
  emscripten::function("boundingBox", &boundingBox);
  emscripten::function("massProperties", &massProperties);
  emscripten::function("mesh", &mesh);
  emscripten::function("exportMesh", &exportMesh);
  emscripten::function("exportStep", &exportStep);
  emscripten::function("importStep", &importStep);
}
