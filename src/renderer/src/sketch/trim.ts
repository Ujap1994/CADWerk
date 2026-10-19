/**
 * Trim and extend: remove the piece of a curve between its neighboring crossings, or lengthen a
 * line or arc up to the next curve. New end points keep their connection to the crossing curve
 * with a relation (or share the existing point that lies there).
 */

import type { SketchArc, SketchCurve, SketchData, SketchLine } from '../../../shared/model/sketch.ts';
import { SketchBuilder } from './builder.ts';
import { constraintReferences, deleteEntities, isCurve, pointPositions, type Point2 } from './geometry.ts';
import { boundaries, extensionTargets, parameterOf, pointAt, shapeOf, type Boundary, type CurveShape } from './intersect.ts';

export type TrimError = 'not-a-curve' | 'no-target' | 'connected' | 'constrained';

export type TrimResult = { ok: true; sketch: SketchData } | { ok: false; error: TrimError };

/** The stretch of a curve that a click at `at` removes: parameters from, to (and whether all of it goes). */
export interface TrimPiece {
  curve: string;
  from: number;
  to: number;
  /** Boundaries at both ends of the piece (undefined at the curve's own ends). */
  start?: Boundary;
  end?: Boundary;
  whole: boolean;
  shape: CurveShape;
}

export function trimPiece(sketch: SketchData, curveId: string, at: Point2): TrimPiece | null {
  const curve = sketch.entities.find((entity) => entity.id === curveId);
  if (!curve || !isCurve(curve)) return null;
  const shape = shapeOf(curve, pointPositions(sketch));
  if (!shape) return null;
  const t = parameterOf(shape, at);
  const splits = boundaries(sketch, curveId);
  if (shape.kind === 'circle' && shape.closed) {
    if (splits.length < 2) return { curve: curveId, from: 0, to: 1, whole: true, shape };
    // Around the circle: the last boundary before the click, the first after it (wrapping around).
    const before = [...splits].reverse().find((b) => b.t < t) ?? (splits.at(-1) as Boundary);
    const after = splits.find((b) => b.t > t) ?? (splits[0] as Boundary);
    return { curve: curveId, from: before.t, to: after.t, start: before, end: after, whole: false, shape };
  }
  const before = [...splits].reverse().find((b) => b.t < t);
  const after = splits.find((b) => b.t > t);
  return { curve: curveId, from: before?.t ?? 0, to: after?.t ?? 1, ...(before ? { start: before } : {}), ...(after ? { end: after } : {}), whole: !before && !after, shape };
}

/** Points along the piece, for highlighting what a click removes. */
export function piecePolyline(piece: TrimPiece, segments = 48): Point2[] {
  let to = piece.to;
  if (piece.shape.kind === 'circle' && piece.shape.closed && to <= piece.from) to += 1;
  if (piece.whole && piece.shape.kind === 'circle' && piece.shape.closed) to = piece.from + 1;
  const count = piece.shape.kind === 'segment' ? 1 : segments;
  return Array.from({ length: count + 1 }, (_, i) => pointAt(piece.shape, piece.from + ((to - piece.from) * i) / count));
}

/** The point to end a curve at a boundary: an existing point there, or a new one kept on the crossing curve. */
function endPointAt(sketch: SketchData, builder: SketchBuilder, boundary: Boundary): string {
  if (boundary.point) return boundary.point;
  const id = builder.freePoint(...boundary.at);
  const other = boundary.curve ? sketch.entities.find((entity) => entity.id === boundary.curve) : undefined;
  if (other?.type === 'line') builder.relation({ type: 'pointOnLine', point: id, line: other.id });
  else if (other?.type === 'circle' || other?.type === 'arc') builder.relation({ type: 'pointOnCircle', point: id, circle: other.id });
  return id;
}

/** Removes points that only the trimmed curve used and that nothing else refers to anymore. */
function dropLoosePoints(sketch: SketchData, candidates: readonly string[]): SketchData {
  const used = new Set<string>();
  for (const entity of sketch.entities) {
    if (entity.type === 'line') used.add(entity.p1).add(entity.p2);
    if (entity.type === 'circle') used.add(entity.center);
    if (entity.type === 'arc') used.add(entity.center).add(entity.start).add(entity.end);
  }
  const loose = candidates.filter((id) => !used.has(id));
  return loose.length > 0 ? deleteEntities(sketch, loose) : sketch;
}

/** Removes the piece of a curve between the crossings around `at` (the whole curve if nothing crosses it). */
export function trimAt(sketch: SketchData, curveId: string, at: Point2): TrimResult {
  const piece = trimPiece(sketch, curveId, at);
  const curve = sketch.entities.find((entity) => entity.id === curveId) as SketchCurve | undefined;
  if (!piece || !curve) return { ok: false, error: 'not-a-curve' };
  if (piece.whole) return { ok: true, sketch: deleteEntities(sketch, [curveId]) };

  const builder = new SketchBuilder(sketch);
  if (curve.type === 'circle') {
    // What remains of the circle is an arc from the piece's end round to its start.
    const start = endPointAt(sketch, builder, piece.end as Boundary);
    const end = endPointAt(sketch, builder, piece.start as Boundary);
    const arc: SketchArc = { id: curve.id, type: 'arc', center: curve.center, start, end, ...(curve.construction ? { construction: true } : {}) };
    builder.replace(curve.id, arc);
    return { ok: true, sketch: builder.build() };
  }

  const [first, last] = curve.type === 'line' ? [curve.p1, curve.p2] : [curve.start, curve.end];
  const withEnds = (from: string, to: string): SketchLine | SketchArc =>
    curve.type === 'line' ? { ...curve, p1: from, p2: to } : { ...curve, start: from, end: to };
  if (!piece.start) {
    builder.replace(curve.id, withEnds(endPointAt(sketch, builder, piece.end as Boundary), last));
    return { ok: true, sketch: dropLoosePoints(builder.build(), [first]) };
  }
  if (!piece.end) {
    builder.replace(curve.id, withEnds(first, endPointAt(sketch, builder, piece.start)));
    return { ok: true, sketch: dropLoosePoints(builder.build(), [last]) };
  }
  // A piece in the middle: the curve keeps its first part, a new curve takes the rest.
  builder.replace(curve.id, withEnds(first, endPointAt(sketch, builder, piece.start)));
  const restStart = endPointAt(sketch, builder, piece.end);
  if (curve.type === 'line') {
    const rest = builder.line(restStart, last, curve.construction === true);
    builder.relation({ type: 'collinear', a: curve.id, b: rest });
  } else {
    const rest = builder.arc(curve.center, restStart, last, curve.construction === true);
    builder.relation({ type: 'equal', a: curve.id, b: rest });
  }
  return { ok: true, sketch: builder.build() };
}

/** Which end of a line or arc is nearer to `at`. */
export function nearerEnd(sketch: SketchData, curveId: string, at: Point2): 'start' | 'end' | null {
  const curve = sketch.entities.find((entity) => entity.id === curveId);
  if (!curve || !isCurve(curve) || curve.type === 'circle') return null;
  const shape = shapeOf(curve, pointPositions(sketch));
  return shape ? (parameterOf(shape, at) < 0.5 ? 'start' : 'end') : null;
}

/** Lengthens a line or arc at its end nearer to `at` up to the next curve in that direction. */
export function extendAt(sketch: SketchData, curveId: string, at: Point2): TrimResult {
  const curve = sketch.entities.find((entity) => entity.id === curveId);
  const end = nearerEnd(sketch, curveId, at);
  if (!curve || !end || (curve.type !== 'line' && curve.type !== 'arc')) return { ok: false, error: 'not-a-curve' };
  const target = extensionTargets(sketch, curveId, end)[0];
  if (!target) return { ok: false, error: 'no-target' };
  const pointId = curve.type === 'line' ? (end === 'start' ? curve.p1 : curve.p2) : end === 'start' ? curve.start : curve.end;
  // An end that other curves share, or that relations and dimensions hold, cannot simply move.
  const sharedBy = sketch.entities.filter(
    (entity) => isCurve(entity) && entity.id !== curveId && (entity.type === 'line' ? [entity.p1, entity.p2] : entity.type === 'arc' ? [entity.start, entity.end, entity.center] : [entity.center]).includes(pointId),
  );
  if (sharedBy.length > 0) return { ok: false, error: 'connected' };
  if (sketch.constraints.some((constraint) => constraintReferences(constraint).includes(pointId))) return { ok: false, error: 'constrained' };
  const builder = new SketchBuilder(sketch);
  const moved = sketch.entities.find((entity) => entity.id === pointId);
  if (moved?.type !== 'point') return { ok: false, error: 'constrained' };
  builder.replace(pointId, { ...moved, x: target.at[0], y: target.at[1] });
  const other = sketch.entities.find((entity) => entity.id === target.curve);
  if (other?.type === 'line') builder.relation({ type: 'pointOnLine', point: pointId, line: other.id });
  else if (other?.type === 'circle' || other?.type === 'arc') builder.relation({ type: 'pointOnCircle', point: pointId, circle: other.id });
  return { ok: true, sketch: builder.build() };
}
