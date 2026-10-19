/**
 * Relation symbols shown next to sketch geometry ("H" next to a horizontal line, "∥" next to both
 * parallel lines, ...). Symbols of one entity line up next to each other, a fixed number of pixels
 * away from it, so they stay readable at every zoom level.
 */

import { isDimension, type SketchConstraint, type SketchData, type SketchEntity } from '../../../shared/model/sketch.ts';
import { arcGeometry, curvePoints, isCurve, type Point2 } from './geometry.ts';
import { relationKindOf, type RelationKind } from './relations.ts';

export const RELATION_SYMBOLS: Record<RelationKind, string> = {
  horizontal: 'H',
  vertical: 'V',
  coincident: '•',
  onCurve: '◦',
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

/** The entities a relation shows its symbol at. */
function anchorsOf(constraint: SketchConstraint): string[] {
  switch (constraint.type) {
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

/**
 * The middle of the connected geometry each curve belongs to (curves sharing points are
 * connected): symbols of a closed outline go outside it, where they do not crowd the inside.
 */
function outlineCenters(sketch: SketchData, positions: ReadonlyMap<string, Point2>): Map<string, Point2> {
  const parent = new Map<string, string>();
  const root = (id: string): string => {
    let top = id;
    while (parent.has(top) && parent.get(top) !== top) top = parent.get(top) as string;
    parent.set(id, top);
    return top;
  };
  const curves = sketch.entities.filter(isCurve).filter((curve) => curve.type !== 'circle');
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
    if (box) centers.set(curve.id, [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]);
  }
  return centers;
}

/** Where the symbols of an entity start and in which direction they continue. */
function placeFor(
  entities: ReadonlyMap<string, SketchEntity>,
  positions: ReadonlyMap<string, Point2>,
  centers: ReadonlyMap<string, Point2>,
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
    // Away from the middle of its outline; a line on its own gets them above or on the left.
    let n: Point2 = [-d[1], d[0]];
    const center = centers.get(id);
    const away = center ? (middle[0] - center[0]) * n[0] + (middle[1] - center[1]) * n[1] : 0;
    if (Math.abs(away) > 1e-6 * length) {
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
  const perEntity = new Map<string, { relation: string; kind: RelationKind }[]>();
  for (const constraint of sketch.constraints) {
    if (isDimension(constraint)) continue;
    const kind = relationKindOf(constraint);
    if (!kind) continue;
    for (const anchor of anchorsOf(constraint)) {
      const list = perEntity.get(anchor) ?? [];
      list.push({ relation: constraint.id, kind });
      perEntity.set(anchor, list);
    }
  }
  const glyphs: RelationGlyph[] = [];
  const centers = outlineCenters(sketch, positions);
  const entities = new Map(sketch.entities.map((entity) => [entity.id, entity]));
  for (const [entity, relations] of perEntity) {
    const place = placeFor(entities, positions, centers, entity, OFFSET_PX * mmPerPixel);
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
