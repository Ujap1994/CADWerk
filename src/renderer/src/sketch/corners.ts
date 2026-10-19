/**
 * Sketch fillets and chamfers: rounding or beveling the corner where two lines meet.
 * The corner point stays as a "virtual sharp" on both lines, so relations and dimensions
 * that refer to it keep their meaning.
 */

import type { SketchData, SketchLine } from '../../../shared/model/sketch.ts';
import { SketchBuilder } from './builder.ts';
import { pointPositions, type Point2 } from './geometry.ts';

export type CornerError = 'not-a-corner' | 'too-large' | 'straight';

export type CornerResult = { ok: true; sketch: SketchData } | { ok: false; error: CornerError };

interface Corner {
  first: SketchLine;
  second: SketchLine;
  at: Point2;
  /** Unit directions from the corner along each line, and the line lengths. */
  u1: Point2;
  u2: Point2;
  length1: number;
  length2: number;
}

/** The two (non-construction) lines that meet at a point, if there are exactly two. */
export function cornerAt(sketch: SketchData, pointId: string): Corner | null {
  const positions = pointPositions(sketch);
  const at = positions.get(pointId);
  if (!at) return null;
  const lines = sketch.entities.filter((entity): entity is SketchLine => entity.type === 'line' && !entity.construction && (entity.p1 === pointId || entity.p2 === pointId));
  const [first, second] = lines;
  if (lines.length !== 2 || !first || !second) return null;
  const away = (line: SketchLine): [Point2, number] | null => {
    const other = positions.get(line.p1 === pointId ? line.p2 : line.p1);
    if (!other) return null;
    const d: Point2 = [other[0] - at[0], other[1] - at[1]];
    const length = Math.hypot(d[0], d[1]);
    return length > 0 ? [[d[0] / length, d[1] / length], length] : null;
  };
  const a = away(first);
  const b = away(second);
  if (!a || !b) return null;
  return { first, second, at, u1: a[0], u2: b[0], length1: a[1], length2: b[1] };
}

/** Replaces the corner point in a line by another point. */
function reattach(line: SketchLine, corner: string, point: string): SketchLine {
  return line.p1 === corner ? { ...line, p1: point } : { ...line, p2: point };
}

/** Shortens both lines to the new points and keeps the corner as a virtual sharp on both lines. */
function trimCorner(builder: SketchBuilder, pointId: string, corner: Corner, t1: string, t2: string): void {
  builder.relation({ type: 'pointOnLine', point: pointId, line: corner.first.id });
  builder.relation({ type: 'pointOnLine', point: pointId, line: corner.second.id });
  builder.replace(corner.first.id, reattach(corner.first, pointId, t1));
  builder.replace(corner.second.id, reattach(corner.second, pointId, t2));
}

/** Rounds the corner at `pointId` with an arc of `radius`, tangent to both lines, with a radius dimension. */
export function filletCorner(sketch: SketchData, pointId: string, radius: number): CornerResult {
  const corner = cornerAt(sketch, pointId);
  if (!corner) return { ok: false, error: 'not-a-corner' };
  const cos = corner.u1[0] * corner.u2[0] + corner.u1[1] * corner.u2[1];
  const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
  if (angle < 1e-6 || Math.PI - angle < 1e-6) return { ok: false, error: 'straight' };
  const setback = radius / Math.tan(angle / 2);
  if (!(radius > 0) || setback >= corner.length1 || setback >= corner.length2) return { ok: false, error: 'too-large' };
  const [px, py] = corner.at;
  const tangent1: Point2 = [px + corner.u1[0] * setback, py + corner.u1[1] * setback];
  const tangent2: Point2 = [px + corner.u2[0] * setback, py + corner.u2[1] * setback];
  const bisector: Point2 = [corner.u1[0] + corner.u2[0], corner.u1[1] + corner.u2[1]];
  const bisectorLength = Math.hypot(bisector[0], bisector[1]);
  const distance = radius / Math.sin(angle / 2);
  const center: Point2 = [px + (bisector[0] / bisectorLength) * distance, py + (bisector[1] / bisectorLength) * distance];

  const builder = new SketchBuilder(sketch);
  const t1 = builder.freePoint(...tangent1);
  const t2 = builder.freePoint(...tangent2);
  const c = builder.freePoint(...center);
  // Counterclockwise from one tangent point to the other, the short way round.
  const turn = (tangent1[0] - center[0]) * (tangent2[1] - center[1]) - (tangent1[1] - center[1]) * (tangent2[0] - center[0]);
  const arc = turn > 0 ? builder.arc(c, t1, t2) : builder.arc(c, t2, t1);
  trimCorner(builder, pointId, corner, t1, t2);
  builder.relation({ type: 'tangent', a: corner.first.id, b: arc });
  builder.relation({ type: 'tangent', a: corner.second.id, b: arc });
  const outward: [number, number] = [(-bisector[0] / bisectorLength) * radius, (-bisector[1] / bisectorLength) * radius];
  builder.dimension({ type: 'radius', circle: arc, value: radius, driving: true, offset: [outward[0] * 2.2, outward[1] * 2.2] });
  return { ok: true, sketch: builder.build() };
}

/** Bevels the corner at `pointId` by `distance` along both lines, with both distances dimensioned. */
export function chamferCorner(sketch: SketchData, pointId: string, distance: number): CornerResult {
  const corner = cornerAt(sketch, pointId);
  if (!corner) return { ok: false, error: 'not-a-corner' };
  const cos = corner.u1[0] * corner.u2[0] + corner.u1[1] * corner.u2[1];
  if (Math.abs(cos) > 1 - 1e-12) return { ok: false, error: 'straight' };
  if (!(distance > 0) || distance >= corner.length1 || distance >= corner.length2) return { ok: false, error: 'too-large' };
  const [px, py] = corner.at;
  const builder = new SketchBuilder(sketch);
  const t1 = builder.freePoint(px + corner.u1[0] * distance, py + corner.u1[1] * distance);
  const t2 = builder.freePoint(px + corner.u2[0] * distance, py + corner.u2[1] * distance);
  builder.line(t1, t2);
  trimCorner(builder, pointId, corner, t1, t2);
  // Each value sits beside its line, on the outside of the corner.
  const inside: Point2 = [corner.u1[0] + corner.u2[0], corner.u1[1] + corner.u2[1]];
  for (const [u, t] of [[corner.u1, t1], [corner.u2, t2]] as const) {
    let normal: Point2 = [-u[1], u[0]];
    if (normal[0] * inside[0] + normal[1] * inside[1] > 0) normal = [-normal[0], -normal[1]];
    builder.dimension({ type: 'distance', a: pointId, b: t, value: distance, driving: true, offset: [normal[0] * distance * 0.8, normal[1] * distance * 0.8] });
  }
  return { ok: true, sketch: builder.build() };
}
