// ParaWerk geometry kernel core (see core.hpp and docs/adr/0001-geometry-kernel.md).

#include "core.hpp"

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
#include <IFSelect_ReturnStatus.hxx>
#include <IMeshTools_Parameters.hxx>
#include <NCollection_IndexedDataMap.hxx>
#include <NCollection_IndexedMap.hxx>
#include <NCollection_List.hxx>
#include <Poly_PolygonOnTriangulation.hxx>
#include <Poly_Triangulation.hxx>
#include <STEPControl_Reader.hxx>
#include <STEPControl_Writer.hxx>
#include <Standard_Failure.hxx>
#include <TopExp.hxx>
#include <TopTools_ShapeMapHasher.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Sphere.hxx>

#include <limits>
#include <sstream>
#include <unordered_map>

namespace parawerk {

KernelError::KernelError(std::string errorCode, const std::string& message)
    : std::runtime_error(message), code(std::move(errorCode)) {}

namespace {

using ShapeMap = NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>;
using AncestorMap = NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher>;

constexpr double kNaN = std::numeric_limits<double>::quiet_NaN();

bool parallel = false;

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

int countSolids(const TopoDS_Shape& shape) {
  ShapeMap solids;
  TopExp::MapShapes(shape, TopAbs_SOLID, solids);
  return solids.Extent();
}

std::vector<TopoDS_Edge> selectEdges(const TopoDS_Shape& body, const std::vector<int>& edgeIndices) {
  ShapeMap edges;
  TopExp::MapShapes(body, TopAbs_EDGE, edges);
  std::vector<TopoDS_Edge> selected;
  for (const int index : edgeIndices) {
    if (index < 0 || index >= edges.Extent()) throw KernelError("edge-missing", "edge " + std::to_string(index) + " does not exist");
    selected.push_back(TopoDS::Edge(edges(index + 1)));
  }
  if (selected.empty()) throw KernelError("no-edges", "no edges selected");
  return selected;
}

/** Fillets can produce invalid solids; catching that keeps later features stable. */
void requireValidSolid(const TopoDS_Shape& result, const char* what) {
  if (countSolids(result) == 0) throw KernelError("operation-failed", std::string(what) + " result is not a solid");
  BRepCheck_Analyzer analyzer(result, false);
  if (!analyzer.IsValid()) throw KernelError("operation-failed", std::string(what) + " produced an invalid solid");
}

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

void pushPoint(std::vector<float>& out, const gp_Pnt& point) {
  out.push_back(static_cast<float>(point.X()));
  out.push_back(static_cast<float>(point.Y()));
  out.push_back(static_cast<float>(point.Z()));
}

/**
 * Triangulates faces that have no sufficient triangulation yet.
 *
 * The 3D view uses Delabella, a fast Delaunay triangulator that matters most for large
 * planar faces with many holes. At the very fine STL tolerance it is much slower than
 * the default Watson algorithm, so exports use Watson (measured, see docs/benchmarks).
 */
void triangulate(const TopoDS_Shape& shape, double linear, double angular, bool forDisplay) {
  IMeshTools_Parameters parameters;
  parameters.MeshAlgo = forDisplay ? IMeshTools_MeshAlgoType_Delabella : IMeshTools_MeshAlgoType_Watson;
  parameters.Deflection = linear;
  parameters.Angle = angular;
  parameters.Relative = false;
  parameters.InParallel = parallel;
  BRepMesh_IncrementalMesh mesher(shape, parameters);
}

void appendFaces(const TopoDS_Shape& shape, MeshData& out, bool withInfo) {
  ShapeMap faces;
  TopExp::MapShapes(shape, TopAbs_FACE, faces);
  out.faceRanges.reserve(static_cast<size_t>(faces.Extent()) * 2);

  for (int f = 1; f <= faces.Extent(); ++f) {
    const TopoDS_Face face = TopoDS::Face(faces(f));
    const uint32_t start = static_cast<uint32_t>(out.indices.size());
    TopLoc_Location location;
    const occ::handle<Poly_Triangulation>& triangulation = BRep_Tool::Triangulation(face, location);
    if (!triangulation.IsNull()) {
      if (!triangulation->HasNormals()) BRepLib_ToolTriangulatedShape::ComputeNormals(face, triangulation);
      const gp_Trsf transform = location.Transformation();
      const bool reversed = face.Orientation() == TopAbs_REVERSED;
      const uint32_t base = static_cast<uint32_t>(out.positions.size() / 3);
      for (int n = 1; n <= triangulation->NbNodes(); ++n) {
        pushPoint(out.positions, triangulation->Node(n).Transformed(transform));
        gp_Dir normal = triangulation->Normal(n).Transformed(transform);
        if (reversed) normal.Reverse();
        out.normals.push_back(static_cast<float>(normal.X()));
        out.normals.push_back(static_cast<float>(normal.Y()));
        out.normals.push_back(static_cast<float>(normal.Z()));
      }
      for (int t = 1; t <= triangulation->NbTriangles(); ++t) {
        int a = 0, b = 0, c = 0;
        triangulation->Triangle(t).Get(a, b, c);
        if (reversed) std::swap(b, c);
        out.indices.push_back(base + static_cast<uint32_t>(a - 1));
        out.indices.push_back(base + static_cast<uint32_t>(b - 1));
        out.indices.push_back(base + static_cast<uint32_t>(c - 1));
      }
    }
    out.faceRanges.push_back(start);
    out.faceRanges.push_back(static_cast<uint32_t>(out.indices.size()) - start);

    if (withInfo) {
      BRepAdaptor_Surface surface(face, false);
      const uint8_t kind = surfaceKind(surface.GetType());
      GProp_GProps props;
      BRepGProp::SurfaceProperties(face, props);
      double radius = kNaN;
      if (kind == Cylinder) radius = surface.Cylinder().Radius();
      else if (kind == Sphere) radius = surface.Sphere().Radius();
      out.faceKinds.push_back(kind);
      out.faceAreas.push_back(props.Mass());
      out.faceRadii.push_back(radius);
      if (kind == Plane) {
        // The adaptor applies the face location; the face orientation decides which side is outside.
        const gp_Pln plane = surface.Plane();
        gp_Dir normal = plane.Axis().Direction();
        if (face.Orientation() == TopAbs_REVERSED) normal.Reverse();
        const gp_Pnt origin = plane.Location();
        out.facePlanes.insert(out.facePlanes.end(), {origin.X(), origin.Y(), origin.Z(), normal.X(), normal.Y(), normal.Z()});
      } else {
        out.facePlanes.insert(out.facePlanes.end(), 6, kNaN);
      }
    }
  }
}

void appendEdges(const TopoDS_Shape& shape, double linear, double angular, MeshData& out) {
  ShapeMap edges;
  TopExp::MapShapes(shape, TopAbs_EDGE, edges);
  AncestorMap edgeFaces;
  TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edgeFaces);

  for (int e = 1; e <= edges.Extent(); ++e) {
    const TopoDS_Edge edge = TopoDS::Edge(edges(e));
    const uint32_t start = static_cast<uint32_t>(out.edgePositions.size() / 3);
    const NCollection_List<TopoDS_Shape>* adjacent = edgeFaces.Seek(edge);
    const bool degenerated = BRep_Tool::Degenerated(edge);

    // Seams (a closed surface meeting itself) and degenerated edges are not drawn.
    bool hidden = degenerated;
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
            pushPoint(out.edgePositions, triangulation->Node(nodes(k)).Transformed(transform));
            pushPoint(out.edgePositions, triangulation->Node(nodes(k + 1)).Transformed(transform));
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
          pushPoint(out.edgePositions, discretizer.Value(k));
          pushPoint(out.edgePositions, discretizer.Value(k + 1));
        }
      }
    }
    out.edgeRanges.push_back(start);
    out.edgeRanges.push_back(static_cast<uint32_t>(out.edgePositions.size() / 3) - start);

    if (degenerated) {
      out.edgeKinds.push_back(OtherCurve);
      out.edgeLengths.push_back(0);
      out.edgeRadii.push_back(kNaN);
      out.edgeGeometry.insert(out.edgeGeometry.end(), 12, kNaN);
    } else {
      BRepAdaptor_Curve curve(edge);
      const uint8_t kind = curveKind(curve.GetType());
      GProp_GProps props;
      BRepGProp::LinearProperties(edge, props);
      out.edgeKinds.push_back(kind);
      out.edgeLengths.push_back(props.Mass());
      out.edgeRadii.push_back(kind == Circle ? curve.Circle().Radius() : kNaN);
      // Start and end follow the curve's parameters (not the edge orientation), so an arc runs
      // counterclockwise around its axis from start to end.
      const gp_Pnt first = curve.Value(curve.FirstParameter());
      const gp_Pnt last = curve.Value(curve.LastParameter());
      out.edgeGeometry.insert(out.edgeGeometry.end(), {first.X(), first.Y(), first.Z(), last.X(), last.Y(), last.Z()});
      if (kind == Circle) {
        const gp_Circ circle = curve.Circle();
        const gp_Pnt center = circle.Location();
        const gp_Dir axis = circle.Axis().Direction();
        out.edgeGeometry.insert(out.edgeGeometry.end(), {center.X(), center.Y(), center.Z(), axis.X(), axis.Y(), axis.Z()});
      } else {
        out.edgeGeometry.insert(out.edgeGeometry.end(), 6, kNaN);
      }
    }
  }
}

/** Sets up and runs a boolean operation, in parallel when enabled. */
void configure(BRepAlgoAPI_BooleanOperation& algorithm, const TopoDS_Shape& body, const TopoDS_Shape& tool) {
  NCollection_List<TopoDS_Shape> arguments;
  arguments.Append(body);
  NCollection_List<TopoDS_Shape> tools;
  tools.Append(tool);
  algorithm.SetArguments(arguments);
  algorithm.SetTools(tools);
  algorithm.SetRunParallel(parallel);
  algorithm.Build();
}

}  // namespace

void setParallel(bool enabled) { parallel = enabled; }

// ------------------------------------------------------------------ features

int makeBox(double x, double y, double z, double dx, double dy, double dz) {
  BRepPrimAPI_MakeBox maker(gp_Pnt(x, y, z), dx, dy, dz);
  return store().add(maker.Shape());
}

int makeCylinder(double px, double py, double pz, double dx, double dy, double dz, double radius, double height) {
  BRepPrimAPI_MakeCylinder maker(gp_Ax2(gp_Pnt(px, py, pz), gp_Dir(dx, dy, dz)), radius, height);
  return store().add(maker.Shape());
}

int booleanOperation(int bodyId, int toolId, int op) {
  const TopoDS_Shape& body = store().get(bodyId);
  const TopoDS_Shape& tool = store().get(toolId);
  TopoDS_Shape result;
  if (op == 0) {
    BRepAlgoAPI_Fuse algorithm;
    configure(algorithm, body, tool);
    if (algorithm.HasErrors()) throw KernelError("operation-failed", "boolean operation failed");
    algorithm.SimplifyResult(true, true, 1e-6);
    result = algorithm.Shape();
  } else {
    BRepAlgoAPI_Cut algorithm;
    configure(algorithm, body, tool);
    if (algorithm.HasErrors()) throw KernelError("operation-failed", "boolean operation failed");
    algorithm.SimplifyResult(true, true, 1e-6);
    result = algorithm.Shape();
  }
  if (countSolids(result) == 0) throw KernelError("empty-result", "the operation removed the whole body");
  return store().add(result);
}

int fillet(int bodyId, const std::vector<int>& edgeIndices, double radius) {
  const TopoDS_Shape& body = store().get(bodyId);
  BRepFilletAPI_MakeFillet maker(body, ChFi3d_Rational);
  for (const TopoDS_Edge& edge : selectEdges(body, edgeIndices)) maker.Add(radius, edge);
  maker.Build();
  if (!maker.IsDone()) throw KernelError("operation-failed", "fillet could not be computed (radius too large?)");
  const TopoDS_Shape result = maker.Shape();
  requireValidSolid(result, "fillet");
  return store().add(result);
}

int chamfer(int bodyId, const std::vector<int>& edgeIndices, double distance) {
  const TopoDS_Shape& body = store().get(bodyId);
  BRepFilletAPI_MakeChamfer maker(body);
  for (const TopoDS_Edge& edge : selectEdges(body, edgeIndices)) maker.Add(distance, edge);
  maker.Build();
  if (!maker.IsDone()) throw KernelError("operation-failed", "chamfer could not be computed (distance too large?)");
  const TopoDS_Shape result = maker.Shape();
  requireValidSolid(result, "chamfer");
  return store().add(result);
}

void release(int id) { store().release(id); }

int shapeCount() { return store().size(); }

// ------------------------------------------------------------------ queries

Counts counts(int id) {
  const TopoDS_Shape& shape = store().get(id);
  ShapeMap faces, edges;
  TopExp::MapShapes(shape, TopAbs_FACE, faces);
  TopExp::MapShapes(shape, TopAbs_EDGE, edges);
  return {faces.Extent(), edges.Extent(), countSolids(shape)};
}

BoundingBox boundingBox(int id) {
  Bnd_Box box;
  BRepBndLib::Add(store().get(id), box, false);
  BoundingBox result;
  if (box.IsVoid()) return result;
  const gp_Pnt min = box.CornerMin();
  const gp_Pnt max = box.CornerMax();
  result.min[0] = min.X();
  result.min[1] = min.Y();
  result.min[2] = min.Z();
  result.max[0] = max.X();
  result.max[1] = max.Y();
  result.max[2] = max.Z();
  return result;
}

MassProperties massProperties(int id) {
  const TopoDS_Shape& shape = store().get(id);
  GProp_GProps volume;
  BRepGProp::VolumeProperties(shape, volume);
  GProp_GProps surface;
  BRepGProp::SurfaceProperties(shape, surface);
  const gp_Pnt center = volume.CentreOfMass();
  MassProperties result;
  result.volume = volume.Mass();
  result.area = surface.Mass();
  result.center[0] = center.X();
  result.center[1] = center.Y();
  result.center[2] = center.Z();
  return result;
}

MeshData mesh(int id, double linear, double angular) {
  const TopoDS_Shape& shape = store().get(id);
  triangulate(shape, linear, angular, true);
  MeshData out;
  appendFaces(shape, out, true);
  appendEdges(shape, linear, angular, out);
  return out;
}

MeshData exportMesh(int id, double linear, double angular) {
  BRepBuilderAPI_Copy copier(store().get(id), true, false);
  const TopoDS_Shape copy = copier.Shape();
  triangulate(copy, linear, angular, false);
  MeshData out;
  appendFaces(copy, out, false);
  return out;
}

// ------------------------------------------------------------------ data exchange

std::string exportStep(int id) {
  STEPControl_Writer writer;
  if (writer.Transfer(store().get(id), STEPControl_AsIs) != IFSelect_RetDone) throw KernelError("operation-failed", "STEP transfer failed");
  std::ostringstream stream;
  if (writer.WriteStream(stream) != IFSelect_RetDone) throw KernelError("operation-failed", "STEP write failed");
  return stream.str();
}

int importStep(const std::string& data) {
  std::istringstream stream(data);
  STEPControl_Reader reader;
  if (reader.ReadStream("import.step", stream) != IFSelect_RetDone) throw KernelError("operation-failed", "the STEP file could not be read");
  if (reader.TransferRoots() == 0) throw KernelError("operation-failed", "the STEP file contains no shapes");
  return store().add(reader.OneShape());
}

// ------------------------------------------------------------------ errors

std::pair<std::string, std::string> describeException(std::exception_ptr error) {
  try {
    std::rethrow_exception(error);
  } catch (const KernelError& e) {
    return {e.code, e.what()};
  } catch (const Standard_Failure& e) {
    const char* text = e.what();
    return {"operation-failed", std::string("OCCT: ") + (text && *text ? text : "geometry error")};
  } catch (const std::exception& e) {
    return {"operation-failed", e.what()};
  } catch (...) {
    return {"operation-failed", "unknown kernel error"};
  }
}

}  // namespace parawerk
