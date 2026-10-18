import type { Axis, BoxFeature, CylinderFeature, EdgeFeature, Feature, Vec3 } from '../shared/model/feature.ts';
import { Arena, describeError, type OC, type TopoDS_Shape } from './occt.ts';
import type { FeatureErrorCode } from './protocol.ts';
import { countSubShapes, uniqueSubShapes } from './topology.ts';

export class FeatureError extends Error {
  readonly code: FeatureErrorCode;
  readonly detail: string | undefined;

  constructor(code: FeatureErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'FeatureError';
    this.code = code;
    this.detail = detail;
  }
}

function axisDirection(axis: Axis): Vec3 {
  switch (axis) {
    case 'x':
      return [1, 0, 0];
    case 'y':
      return [0, 1, 0];
    case 'z':
      return [0, 0, 1];
  }
}

function makeBox(oc: OC, arena: Arena, feature: BoxFeature): TopoDS_Shape {
  const [x, y, z] = feature.position;
  const corner = arena.track(new oc.gp_Pnt(x - feature.width / 2, y - feature.depth / 2, z));
  const maker = arena.track(new oc.BRepPrimAPI_MakeBox(corner, feature.width, feature.depth, feature.height));
  return arena.track(maker.Shape());
}

function makeCylinder(oc: OC, arena: Arena, feature: CylinderFeature): TopoDS_Shape {
  const [x, y, z] = feature.position;
  const [dx, dy, dz] = axisDirection(feature.axis);
  const origin = arena.track(new oc.gp_Pnt(x, y, z));
  const direction = arena.track(new oc.gp_Dir(dx, dy, dz));
  const axes = arena.track(new oc.gp_Ax2(origin, direction));
  const maker = arena.track(new oc.BRepPrimAPI_MakeCylinder(axes, feature.radius, feature.height));
  return arena.track(maker.Shape());
}

function combine(oc: OC, arena: Arena, body: TopoDS_Shape | null, tool: TopoDS_Shape, feature: BoxFeature | CylinderFeature) {
  if (body === null) {
    if (feature.operation === 'cut') throw new FeatureError('first-must-add');
    return tool;
  }
  const progress = arena.track(new oc.Message_ProgressRange());
  const algorithm =
    feature.operation === 'add'
      ? arena.trackAlgorithm(new oc.BRepAlgoAPI_Fuse(body, tool, progress))
      : arena.trackAlgorithm(new oc.BRepAlgoAPI_Cut(body, tool, progress));
  if (algorithm.HasErrors()) throw new FeatureError('operation-failed', 'boolean operation failed');
  // Merge coplanar faces and collinear edges so the topology stays clean for later features.
  algorithm.SimplifyResult(true, true, 1e-6);
  const result = arena.track(algorithm.Shape());
  if (countSubShapes(oc, arena, result, 'solid') === 0) throw new FeatureError('empty-result');
  return result;
}

function applyEdgeFeature(oc: OC, arena: Arena, body: TopoDS_Shape | null, feature: EdgeFeature): TopoDS_Shape {
  if (body === null) throw new FeatureError('no-body');
  if (feature.edges.length === 0) throw new FeatureError('no-edges');
  const edges = uniqueSubShapes(oc, arena, body, 'edge');
  const selected = feature.edges.map((ref) => {
    const edge = edges[ref.index];
    if (!edge) throw new FeatureError('edge-missing');
    return oc.TopoDS.Edge(edge);
  });
  selected.forEach((edge) => arena.track(edge));

  const progress = arena.track(new oc.Message_ProgressRange());
  let result: TopoDS_Shape;
  if (feature.type === 'fillet') {
    // Reset() releases internal fillet data that delete() alone keeps in the current build (ADR 0001).
    const maker = arena.trackWithCleanup(new oc.BRepFilletAPI_MakeFillet(body, oc.ChFi3d_FilletShape.ChFi3d_Rational), (m) => m.Reset());
    for (const edge of selected) maker.Add(feature.radius, edge);
    maker.Build(progress);
    if (!maker.IsDone()) throw new FeatureError('operation-failed', 'fillet could not be computed (radius too large?)');
    result = arena.track(maker.Shape());
  } else {
    const maker = arena.trackWithCleanup(new oc.BRepFilletAPI_MakeChamfer(body), (m) => m.Reset());
    for (const edge of selected) maker.Add(feature.distance, edge);
    maker.Build(progress);
    if (!maker.IsDone()) throw new FeatureError('operation-failed', 'chamfer could not be computed (distance too large?)');
    result = arena.track(maker.Shape());
  }

  // BRepCheck_Analyzer would catch invalid fillets, but it leaks memory in the current
  // WebAssembly build, so only a cheap sanity check runs here (see ADR 0001).
  if (countSubShapes(oc, arena, result, 'solid') === 0) throw new FeatureError('operation-failed', 'the result is not a solid');
  return result;
}

/**
 * Applies one feature to the body and returns the new body.
 *
 * The returned shape is owned by the caller; every temporary object is released.
 */
export function applyFeature(oc: OC, body: TopoDS_Shape | null, feature: Feature): TopoDS_Shape {
  using arena = new Arena();
  try {
    let result: TopoDS_Shape;
    switch (feature.type) {
      case 'box':
        result = combine(oc, arena, body, makeBox(oc, arena, feature), feature);
        break;
      case 'cylinder':
        result = combine(oc, arena, body, makeCylinder(oc, arena, feature), feature);
        break;
      case 'fillet':
      case 'chamfer':
        result = applyEdgeFeature(oc, arena, body, feature);
        break;
    }
    return arena.keep(result);
  } catch (error) {
    if (error instanceof FeatureError) throw error;
    throw new FeatureError('operation-failed', describeError(oc, error));
  }
}
