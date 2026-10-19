/**
 * Relation symbols shown next to sketch geometry ("H" next to a horizontal line, "∥" next to both
 * parallel lines, ...). Symbols of one entity line up next to each other, a fixed number of pixels
 * away from it, so they stay readable at every zoom level.
 */

import { isDimension, type SketchArc, type SketchConstraint, type SketchData, type SketchEntity, type SketchLine } from '../../../shared/model/sketch.ts';
import { arcGeometry, curvePoints, type Point2 } from './geometry.ts';
import { relationKindOf, type RelationKind } from './relations.ts';

export const RELATION_SYMBOLS: Record<RelationKind, string> = {
  horizontal: 'H',
  vertical: 'V',
  coincident: '•',
  onCurve: '○',
  midpoint: 'M',
  parallel: '∥',
  perpendicular: '⊥',
  collinear: '⋯',
  equal: '=',
  tangent: 'T',
  concentric: '◎',
  symmetric: 'S',
  fix: 'F',
};

export interface RelationGlyph {
  /** Unique per relation and entity (a relation of two entities shows a symbol at each). */
  key: string;
  relation: string;
  kind: RelationKind;
  symbol: string;
  at: Point2;
}

/** Distance of the first symbol from its entity and between symbols, in pixels. */
const OFFSET_PX = 13;
const SPACING_PX = 17;

/** The end point two curves share, if any (lines and arcs). */
function sharedEnd(entities: ReadonlyMap<string, SketchEntity>, a: string, b: string): string | null {
  const ends = (id: string): string[] => {
    const entity = entities.get(id);
    return entity?.type === 'line' ? [entity.p1, entity.p2] : entity?.type === 'arc' ? [entity.start, entity.end] : [];
  };
  const other = ends(b);
  return ends(a).find((point) => other.includes(point)) ?? null;
}

/** The entities a relation shows its symbol at. */
function anchorsOf(constraint: SketchConstraint, entities: ReadonlyMap<string, SketchEntity>): string[] {
  switch (constraint.type) {
    case 'tangent': {
      // Tangent curves meeting at a point: one symbol at the joint.
      const joint = sharedEnd(entities, constraint.a, constraint.b);
      return joint ? [joint] : [constraint.a, constraint.b];
    }
    case 'horizontal':
    case 'vertical':
      return [constraint.line];
    case 'midpoint':
    case 'pointOnLine':
    case 'pointOnCircle':
    case 'fix':
      return [constraint.point];
    case 'symmetric':
      return [constraint.a, constraint.b];
    case 'coincident':
    case 'horizontalPoints':
    case 'verticalPoints':
      return [constraint.b];
    default:
      return 'a' in constraint && 'b' in constraint ? [constraint.a, constraint.b] : [];
  }
}

/** Where line symbols go: outside closed outlines, or else away from the middle of their connected geometry. */
interface LineSides {
  /** Lines of simple closed loops: +1 when the outside is left of p1 → p2, −1 when it is right. */
  outside: Map<string, 1 | -1>;
  /** The middle of the connected geometry each line belongs to (curves sharing points are connected). */
  centers: Map<string, Point2>;
}

const endsOf = (curve: SketchLine | SketchArc): [string, string] => (curve.type === 'line' ? [curve.p1, curve.p2] : [curve.start, curve.end]);

/** Walks each simple closed loop (every point joins exactly two curves) and finds the outside of its lines. */
function loopSides(curves: readonly (SketchLine | SketchArc)[], positions: ReadonlyMap<string, Point2>): Map<string, 1 | -1> {
  const atPoint = new Map<string, (SketchLine | SketchArc)[]>();
  for (const curve of curves) {
    for (const point of endsOf(curve)) {
      const list = atPoint.get(point) ?? [];
      list.push(curve);
      atPoint.set(point, list);
    }
  }
  const outside = new Map<string, 1 | -1>();
  const visited = new Set<string>();
  for (const first of curves) {
    if (visited.has(first.id)) continue;
    const walk: { curve: SketchLine | SketchArc; forward: boolean }[] = [];
    let curve = first;
    let from = endsOf(first)[0];
    let closed = false;
    for (;;) {
      visited.add(curve.id);
      const [a, b] = endsOf(curve);
      const forward = from === a;
      walk.push({ curve, forward });
      const to = forward ? b : a;
      const joined = atPoint.get(to) ?? [];
      if (joined.length !== 2) break;
      const next = joined[0] === curve ? (joined[1] as SketchLine | SketchArc) : (joined[0] as SketchLine | SketchArc);
      if (next === first) {
        closed = true;
        break;
      }
      if (visited.has(next.id)) break;
      curve = next;
      from = to;
    }
    if (!closed) continue;
    // Signed area (positive: counterclockwise); arcs count with their midpoints.
    const outline: Point2[] = [];
    for (const step of walk) {
      const [a, b] = endsOf(step.curve);
      const start = positions.get(step.forward ? a : b);
      if (start) outline.push(start);
      if (step.curve.type === 'arc') {
        const center = positions.get(step.curve.center);
        const arcStart = positions.get(step.curve.start);
        const arcEnd = positions.get(step.curve.end);
        if (center && arcStart && arcEnd) {
          const arc = arcGeometry(center, arcStart, arcEnd);
          const angle = arc.startAngle + arc.sweep / 2;
          outline.push([center[0] + arc.radius * Math.cos(angle), center[1] + arc.radius * Math.sin(angle)]);
        }
      }
    }
    let area = 0;
    outline.forEach((p, i) => {
      const q = outline[(i + 1) % outline.length] as Point2;
      area += p[0] * q[1] - q[0] * p[1];
    });
    if (Math.abs(area) < 1e-12) continue;
    // Walking counterclockwise, the inside is on the left.
    for (const step of walk) {
      if (step.curve.type === 'line') outside.set(step.curve.id, area > 0 === step.forward ? -1 : 1);
    }
  }
  return outside;
}

function lineSides(sketch: SketchData, positions: ReadonlyMap<string, Point2>): LineSides {
  const curves = sketch.entities.filter((entity): entity is SketchLine | SketchArc => entity.type === 'line' || entity.type === 'arc');
  const parent = new Map<string, string>();
  const root = (id: string): string => {
    let top = id;
    while (parent.has(top) && parent.get(top) !== top) top = parent.get(top) as string;
    parent.set(id, top);
    return top;
  };
  for (const curve of curves) for (const point of curvePoints(curve)) parent.set(root(point), root(curve.id));
  const bounds = new Map<string, [number, number, number, number]>();
  for (const curve of curves) {
    for (const point of curvePoints(curve)) {
      const at = positions.get(point);
      if (!at) continue;
      const key = root(curve.id);
      const box = bounds.get(key) ?? [at[0], at[1], at[0], at[1]];
      bounds.set(key, [Math.min(box[0], at[0]), Math.min(box[1], at[1]), Math.max(box[2], at[0]), Math.max(box[3], at[1])]);
    }
  }
  const centers = new Map<string, Point2>();
  for (const curve of curves) {
    const box = bounds.get(root(curve.id));
    if (box && curve.type === 'line') centers.set(curve.id, [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]);
  }
  return { outside: loopSides(curves, positions), centers };
}

/** Where the symbols of an entity start and in which direction they continue. */
function placeFor(
  entities: ReadonlyMap<string, SketchEntity>,
  positions: ReadonlyMap<string, Point2>,
  sides: LineSides,
  id: string,
  offset: number,
): { base: Point2; along: Point2 } | null {
  const point = positions.get(id);
  if (point) return { base: [point[0] + offset * 0.7, point[1] - offset * 0.9], along: [1, 0] };
  const entity = entities.get(id);
  if (entity?.type === 'line') {
    const a = positions.get(entity.p1);
    const b = positions.get(entity.p2);
    if (!a || !b) return null;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const d: Point2 = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    const middle: Point2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    // Outside a closed outline, else away from the middle of the connected geometry; a line on its
    // own gets them above or on the left.
    let n: Point2 = [-d[1], d[0]];
    const outside = sides.outside.get(id);
    const center = sides.centers.get(id);
    const away = center ? (middle[0] - center[0]) * n[0] + (middle[1] - center[1]) * n[1] : 0;
    if (outside) n = [n[0] * outside, n[1] * outside];
    else if (Math.abs(away) > 1e-6 * length) {
      if (away < 0) n = [-n[0], -n[1]];
    } else if (n[1] < -1e-9 || (Math.abs(n[1]) <= 1e-9 && n[0] > 0)) n = [-n[0], -n[1]];
    return { base: [middle[0] + n[0] * offset, middle[1] + n[1] * offset], along: d[0] < 0 ? [-d[0], -d[1]] : d };
  }
  if (entity?.type === 'circle' || entity?.type === 'arc') {
    const center = positions.get(entity.center);
    if (!center) return null;
    let radius = entity.type === 'circle' ? entity.radius : 0;
    let angle = Math.PI / 4;
    if (entity.type === 'arc') {
      const start = positions.get(entity.start);
      const end = positions.get(entity.end);
      if (!start || !end) return null;
      const arc = arcGeometry(center, start, end);
      radius = arc.radius;
      angle = arc.startAngle + arc.sweep / 2;
    }
    const r = radius + offset;
    return { base: [center[0] + r * Math.cos(angle), center[1] + r * Math.sin(angle)], along: [1, 0] };
  }
  return null;
}

/** Symbols for all relations of a sketch (dimensions have their own display). */
export function relationGlyphs(sketch: SketchData, positions: ReadonlyMap<string, Point2>, mmPerPixel: number): RelationGlyph[] {
  const entities = new Map(sketch.entities.map((entity) => [entity.id, entity]));
  const perEntity = new Map<string, { relation: string; kind: RelationKind }[]>();
  for (const constraint of sketch.constraints) {
    if (isDimension(constraint)) continue;
    const kind = relationKindOf(constraint);
    if (!kind) continue;
    for (const anchor of anchorsOf(constraint, entities)) {
      const list = perEntity.get(anchor) ?? [];
      list.push({ relation: constraint.id, kind });
      perEntity.set(anchor, list);
    }
  }
  const glyphs: RelationGlyph[] = [];
  const sides = lineSides(sketch, positions);
  for (const [entity, relations] of perEntity) {
    const place = placeFor(entities, positions, sides, entity, OFFSET_PX * mmPerPixel);
    if (!place) continue;
    // Centered on the entity, one symbol next to the other.
    const first = -((relations.length - 1) / 2) * SPACING_PX * mmPerPixel;
    relations.forEach(({ relation, kind }, i) => {
      const shift = first + i * SPACING_PX * mmPerPixel;
      glyphs.push({
        key: `${relation}:${entity}`,
        relation,
        kind,
        symbol: RELATION_SYMBOLS[kind],
        at: [place.base[0] + place.along[0] * shift, place.base[1] + place.along[1] * shift],
      });
    });
  }
  return glyphs;
}
