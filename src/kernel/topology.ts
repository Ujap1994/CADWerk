import type { Arena, OC, TopoDS_Shape } from './occt.ts';

type ShapeKind = 'face' | 'edge' | 'solid';

const HASH_UPPER_BOUND = 2147483647;

function shapeEnum(oc: OC, kind: ShapeKind) {
  switch (kind) {
    case 'face':
      return oc.TopAbs_ShapeEnum.TopAbs_FACE;
    case 'edge':
      return oc.TopAbs_ShapeEnum.TopAbs_EDGE;
    case 'solid':
      return oc.TopAbs_ShapeEnum.TopAbs_SOLID;
  }
}

/**
 * Unique sub-shapes in the same order as OCCT's `TopExp::MapShapes`.
 *
 * This order defines topological face and edge indices; the mesh extractor uses
 * the same order, so index i in a mesh is sub-shape i here. The returned shapes
 * are tracked by the arena.
 */
export function uniqueSubShapes(oc: OC, arena: Arena, shape: TopoDS_Shape, kind: ShapeKind): TopoDS_Shape[] {
  const result: TopoDS_Shape[] = [];
  const buckets = new Map<number, TopoDS_Shape[]>();
  const explorer = arena.track(new oc.TopExp_Explorer(shape, shapeEnum(oc, kind), oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
  for (; explorer.More(); explorer.Next()) {
    const current = arena.track(explorer.Current());
    const hash = oc.ReplicadShapeHasher.HashCode(current, HASH_UPPER_BOUND);
    const bucket = buckets.get(hash);
    if (bucket?.some((candidate) => candidate.IsSame(current))) continue;
    if (bucket) bucket.push(current);
    else buckets.set(hash, [current]);
    result.push(current);
  }
  return result;
}

export function countSubShapes(oc: OC, arena: Arena, shape: TopoDS_Shape, kind: ShapeKind): number {
  return uniqueSubShapes(oc, arena, shape, kind).length;
}
