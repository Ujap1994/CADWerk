/**
 * 2D geometry of sketches for display and interaction: point lookup, tessellation,
 * hit testing and deletion with dependents. All coordinates are sketch coordinates (mm).
 */

import { ORIGIN_ID, type SketchConstraint, type SketchCurve, type SketchData, type SketchEntity } from '../../../shared/model/sketch.ts';

export type Point2 = readonly [number, number];

/** Display deviation of tessellated circles and arcs from the true curve, in pixels. */
const MAX_DEVIATION_PX = 0.2;
const MAX_SEGMENTS = 720;

/** Positions of all sketch points by id, including the fixed sketch origin. */
export function pointPositions(sketch: SketchData): Map<string, Point2> {
  const positions = new Map<string, Point2>([[ORIGIN_ID, [0, 0]]]);
  for (const entity of sketch.entities) if (entity.type === 'point') positions.set(entity.id, [entity.x, entity.y]);
  return positions;
}

export function isCurve(entity: SketchEntity): entity is SketchCurve {
  return entity.type !== 'point';
}

/** Points a curve is built from (end points, center). */
export function curvePoints(curve: SketchCurve): string[] {
  switch (curve.type) {
    case 'line':
      return [curve.p1, curve.p2];
    case 'circle':
      return [curve.center];
    case 'arc':
      return [curve.center, curve.start, curve.end];
  }
}

/** Ids of the points that belong to curves; all other points are stand-alone sketch points. */
export function curvePointIds(sketch: SketchData): Set<string> {
  const ids = new Set<string>();
  for (const entity of sketch.entities) if (isCurve(entity)) for (const id of curvePoints(entity)) ids.add(id);
  return ids;
}

export interface ArcGeometry {
  center: Point2;
  radius: number;
  startAngle: number;
  /** Counterclockwise sweep from start to end, in (0, 2π]. */
  sweep: number;
}

export function arcGeometry(center: Point2, start: Point2, end: Point2): ArcGeometry {
  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0]);
  let sweep = Math.atan2(end[1] - center[1], end[0] - center[0]) - startAngle;
  while (sweep <= 0) sweep += 2 * Math.PI;
  while (sweep > 2 * Math.PI) sweep -= 2 * Math.PI;
  return { center, radius: Math.hypot(start[0] - center[0], start[1] - center[1]), startAngle, sweep };
}

/** Number of segments that keep a circular curve within MAX_DEVIATION_PX of the true shape. */
export function segmentCount(radius: number, sweep: number, mmPerPixel: number): number {
  const tolerance = MAX_DEVIATION_PX * mmPerPixel;
  const minimum = Math.max(2, Math.ceil((12 * sweep) / (2 * Math.PI)));
  if (!(radius > tolerance)) return minimum;
  const step = 2 * Math.acos(1 - tolerance / radius);
  return Math.min(MAX_SEGMENTS, Math.max(minimum, Math.ceil(sweep / step)));
}

/** The curve as a polyline, fine enough for the given zoom; null if a referenced point is missing. */
export function curvePolyline(curve: SketchCurve, positions: ReadonlyMap<string, Point2>, mmPerPixel: number): Point2[] | null {
  if (curve.type === 'line') {
    const p1 = positions.get(curve.p1);
    const p2 = positions.get(curve.p2);
    return p1 && p2 ? [p1, p2] : null;
  }
  const center = positions.get(curve.center);
  if (!center) return null;
  let arc: ArcGeometry;
  if (curve.type === 'circle') {
    arc = { center, radius: curve.radius, startAngle: 0, sweep: 2 * Math.PI };
  } else {
    const start = positions.get(curve.start);
    const end = positions.get(curve.end);
    if (!start || !end) return null;
    arc = arcGeometry(center, start, end);
  }
  const count = segmentCount(arc.radius, arc.sweep, mmPerPixel);
  const points: Point2[] = [];
  for (let i = 0; i <= count; i++) {
    const angle = arc.startAngle + (arc.sweep * i) / count;
    points.push([center[0] + arc.radius * Math.cos(angle), center[1] + arc.radius * Math.sin(angle)]);
  }
  return points;
}

function distanceToSegment(u: number, v: number, a: Point2, b: Point2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((u - a[0]) * dx + (v - a[1]) * dy) / lengthSquared)) : 0;
  return Math.hypot(u - (a[0] + t * dx), v - (a[1] + t * dy));
}

/** Distance from (u, v) to a curve; Infinity if a referenced point is missing. */
export function distanceToCurve(curve: SketchCurve, positions: ReadonlyMap<string, Point2>, u: number, v: number): number {
  if (curve.type === 'line') {
    const p1 = positions.get(curve.p1);
    const p2 = positions.get(curve.p2);
    return p1 && p2 ? distanceToSegment(u, v, p1, p2) : Infinity;
  }
  const center = positions.get(curve.center);
  if (!center) return Infinity;
  const fromCenter = Math.hypot(u - center[0], v - center[1]);
  if (curve.type === 'circle') return Math.abs(fromCenter - curve.radius);
  const start = positions.get(curve.start);
  const end = positions.get(curve.end);
  if (!start || !end) return Infinity;
  const arc = arcGeometry(center, start, end);
  let angle = Math.atan2(v - center[1], u - center[0]) - arc.startAngle;
  while (angle < 0) angle += 2 * Math.PI;
  if (angle <= arc.sweep) return Math.abs(fromCenter - arc.radius);
  return Math.min(Math.hypot(u - start[0], v - start[1]), Math.hypot(u - end[0], v - end[1]));
}

export interface SketchHit {
  id: string;
  type: SketchEntity['type'];
  distance: number;
}

/**
 * The entity under the cursor: the nearest point within `tolerance`, otherwise the nearest
 * curve. Points win so that end points and centers stay grabbable on top of their curves.
 */
export function hitTest(sketch: SketchData, positions: ReadonlyMap<string, Point2>, u: number, v: number, tolerance: number): SketchHit | null {
  let point: SketchHit | null = null;
  let curve: SketchHit | null = null;
  for (const entity of sketch.entities) {
    if (entity.type === 'point') {
      const distance = Math.hypot(u - entity.x, v - entity.y);
      if (distance <= tolerance && (!point || distance < point.distance)) point = { id: entity.id, type: 'point', distance };
    } else {
      const distance = distanceToCurve(entity, positions, u, v);
      if (distance <= tolerance && (!curve || distance < curve.distance)) curve = { id: entity.id, type: entity.type, distance };
    }
  }
  return point ?? curve;
}

const REFERENCE_FIELDS = ['a', 'b', 'line', 'point', 'circle'] as const;

/** Entity ids a constraint refers to. */
export function constraintReferences(constraint: SketchConstraint): string[] {
  const record = constraint as unknown as Record<string, unknown>;
  return REFERENCE_FIELDS.flatMap((field) => (typeof record[field] === 'string' ? [record[field] as string] : []));
}

/**
 * Deletes entities and constraints (by id) and what depends on them: curves built on a deleted
 * point, points that only served deleted curves, and constraints that refer to anything deleted.
 */
export function deleteEntities(sketch: SketchData, ids: Iterable<string>): SketchData {
  const deleted = new Set(ids);
  // Curves that use a deleted point go too.
  for (const entity of sketch.entities) {
    if (isCurve(entity) && curvePoints(entity).some((id) => deleted.has(id))) deleted.add(entity.id);
  }
  // End points and centers of deleted curves go when no remaining curve uses them.
  const orphanCandidates = new Set<string>();
  const stillUsed = new Set<string>();
  for (const entity of sketch.entities) {
    if (!isCurve(entity)) continue;
    for (const id of curvePoints(entity)) (deleted.has(entity.id) ? orphanCandidates : stillUsed).add(id);
  }
  for (const id of orphanCandidates) if (!stillUsed.has(id)) deleted.add(id);
  // Curves may end at the sketch origin; it is not an entity and never goes away.
  deleted.delete(ORIGIN_ID);

  const entities = sketch.entities.filter((entity) => !deleted.has(entity.id));
  const constraints = sketch.constraints.filter(
    (constraint) => !deleted.has(constraint.id) && !constraintReferences(constraint).some((id) => deleted.has(id)),
  );
  if (entities.length === sketch.entities.length && constraints.length === sketch.constraints.length) return sketch;
  return { entities, constraints };
}
