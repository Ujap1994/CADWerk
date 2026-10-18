import { Arena, type OC, type TopoDS_Shape } from './occt.ts';
import type { CurveKind, EdgeInfo, FaceInfo, SurfaceKind } from './protocol.ts';
import { uniqueSubShapes } from './topology.ts';

function surfaceKind(oc: OC, type: unknown): SurfaceKind {
  const t = oc.GeomAbs_SurfaceType;
  switch (type) {
    case t.GeomAbs_Plane:
      return 'plane';
    case t.GeomAbs_Cylinder:
      return 'cylinder';
    case t.GeomAbs_Cone:
      return 'cone';
    case t.GeomAbs_Sphere:
      return 'sphere';
    case t.GeomAbs_Torus:
      return 'torus';
    case t.GeomAbs_BezierSurface:
    case t.GeomAbs_BSplineSurface:
      return 'bspline';
    case t.GeomAbs_SurfaceOfRevolution:
      return 'revolution';
    case t.GeomAbs_SurfaceOfExtrusion:
      return 'extrusion';
    default:
      return 'other';
  }
}

function curveKind(oc: OC, type: unknown): CurveKind {
  const t = oc.GeomAbs_CurveType;
  switch (type) {
    case t.GeomAbs_Line:
      return 'line';
    case t.GeomAbs_Circle:
      return 'circle';
    case t.GeomAbs_Ellipse:
      return 'ellipse';
    case t.GeomAbs_BezierCurve:
    case t.GeomAbs_BSplineCurve:
      return 'bspline';
    default:
      return 'other';
  }
}

/**
 * Exact geometry of every face and edge (type, radius, area, length), taken from
 * the B-Rep, not from the display triangles. Indices match the mesh ranges.
 */
export function describeTopology(oc: OC, shape: TopoDS_Shape): { faces: FaceInfo[]; edges: EdgeInfo[] } {
  using arena = new Arena();
  const faces = uniqueSubShapes(oc, arena, shape, 'face').map((face): FaceInfo => {
    const typed = arena.track(oc.TopoDS.Face(face));
    const adaptor = arena.track(new oc.BRepAdaptor_Surface(typed, true));
    const kind = surfaceKind(oc, adaptor.GetType());
    const props = arena.track(new oc.GProp_GProps());
    oc.BRepGProp.SurfaceProperties(typed, props, false, false);
    const info: FaceInfo = { kind, area: props.Mass() };
    if (kind === 'cylinder') info.radius = arena.track(adaptor.Cylinder()).Radius();
    else if (kind === 'sphere') info.radius = arena.track(adaptor.Sphere()).Radius();
    return info;
  });
  const edges = uniqueSubShapes(oc, arena, shape, 'edge').map((edge): EdgeInfo => {
    const typed = arena.track(oc.TopoDS.Edge(edge));
    const props = arena.track(new oc.GProp_GProps());
    oc.BRepGProp.LinearProperties(typed, props, false, false);
    if (oc.BRep_Tool.Degenerated(typed)) return { kind: 'other', length: 0 };
    const adaptor = arena.track(new oc.BRepAdaptor_Curve(typed));
    const kind = curveKind(oc, adaptor.GetType());
    const info: EdgeInfo = { kind, length: props.Mass() };
    if (kind === 'circle') info.radius = arena.track(adaptor.Circle()).Radius();
    return info;
  });
  return { faces, edges };
}
