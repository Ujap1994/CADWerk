/**
 * Copies of sketch geometry: mirrored about a line, in linear or circular patterns, or moved and
 * rotated. Copies get relations that keep them related to the original where that is the intent:
 * mirrored points stay symmetric, pattern copies of circles and arcs keep an equal radius.
 */

import { ORIGIN_ID, type SketchData, type SketchEntity } from '../../../shared/model/sketch.ts';
import { SketchBuilder } from './builder.ts';
import { curvePoints, isCurve, pointPositions, type Point2 } from './geometry.ts';

type Transform = (point: Point2) => Point2;

/** The entities a selection consists of: selected curves with their points, and selected points. */
function selectedGeometry(sketch: SketchData, ids: readonly string[]): { curves: SketchEntity[]; points: Set<string> } {
  const selected = new Set(ids);
  const curves = sketch.entities.filter((entity) => isCurve(entity) && selected.has(entity.id));
  const points = new Set<string>();
  for (const curve of curves) if (isCurve(curve)) for (const id of curvePoints(curve)) points.add(id);
  for (const entity of sketch.entities) if (entity.type === 'point' && selected.has(entity.id)) points.add(entity.id);
  return { curves, points };
}

interface CopyResult {
  /** Original point id → id of its copy. */
  points: Map<string, string>;
  /** Original curve id → id of its copy. */
  curves: Map<string, string>;
}

/**
 * Copies curves and points with `transform`. Points for which `keep` returns true are shared
 * instead of copied (e.g. points on the mirror axis); `reverse` swaps arc ends (mirroring).
 */
function copyGeometry(
  sketch: SketchData,
  builder: SketchBuilder,
  geometry: { curves: SketchEntity[]; points: Set<string> },
  transform: Transform,
  options: { reverse?: boolean; keep?: (id: string, at: Point2) => boolean } = {},
): CopyResult {
  const positions = pointPositions(sketch);
  const points = new Map<string, string>();
  for (const id of geometry.points) {
    const at = positions.get(id);
    if (!at) continue;
    if (options.keep?.(id, at)) points.set(id, id);
    else points.set(id, builder.freePoint(...transform(at)));
  }
  const curves = new Map<string, string>();
  const mapped = (id: string) => points.get(id) ?? id;
  for (const curve of geometry.curves) {
    const construction = curve.construction === true;
    if (curve.type === 'line') curves.set(curve.id, builder.line(mapped(curve.p1), mapped(curve.p2), construction));
    else if (curve.type === 'circle') curves.set(curve.id, builder.circle(mapped(curve.center), curve.radius, construction));
    else if (curve.type === 'arc') {
      const [start, end] = options.reverse ? [mapped(curve.end), mapped(curve.start)] : [mapped(curve.start), mapped(curve.end)];
      curves.set(curve.id, builder.arc(mapped(curve.center), start, end, construction));
    }
  }
  return { points, curves };
}

export type TransformError = 'nothing-selected' | 'no-axis';

export type TransformResult = { ok: true; sketch: SketchData } | { ok: false; error: TransformError };

/**
 * The mirror axis of a selection: its only construction line, or else the line selected last.
 * The axis itself is not mirrored.
 */
export function mirrorAxis(sketch: SketchData, ids: readonly string[]): string | null {
  const lines = ids.map((id) => sketch.entities.find((entity) => entity.id === id)).filter((entity) => entity?.type === 'line');
  const construction = lines.filter((line) => line?.construction);
  if (construction.length === 1) return construction[0]?.id ?? null;
  return lines.length >= 2 || (lines.length === 1 && ids.length > 1) ? (lines.at(-1)?.id ?? null) : null;
}

/** Mirrors the selection about a line; mirrored points stay symmetric to their originals. */
export function mirrorSelection(sketch: SketchData, ids: readonly string[]): TransformResult {
  const axis = mirrorAxis(sketch, ids);
  const line = sketch.entities.find((entity) => entity.id === axis);
  if (!axis || line?.type !== 'line') return { ok: false, error: 'no-axis' };
  const positions = pointPositions(sketch);
  const a = positions.get(line.p1);
  const b = positions.get(line.p2);
  if (!a || !b) return { ok: false, error: 'no-axis' };
  const geometry = selectedGeometry(
    sketch,
    ids.filter((id) => id !== axis),
  );
  if (geometry.curves.length === 0 && geometry.points.size === 0) return { ok: false, error: 'nothing-selected' };
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const d: Point2 = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  const reflect: Transform = ([x, y]) => {
    const along = (x - a[0]) * d[0] + (y - a[1]) * d[1];
    const foot: Point2 = [a[0] + d[0] * along, a[1] + d[1] * along];
    return [2 * foot[0] - x, 2 * foot[1] - y];
  };
  const onAxis = (_id: string, at: Point2) => Math.abs((at[0] - a[0]) * d[1] - (at[1] - a[1]) * d[0]) <= 1e-9 * Math.max(1, length);
  const builder = new SketchBuilder(sketch);
  const copy = copyGeometry(sketch, builder, geometry, reflect, { reverse: true, keep: onAxis });
  for (const [original, mirrored] of copy.points) {
    if (original !== mirrored && original !== ORIGIN_ID) builder.relation({ type: 'symmetric', a: original, b: mirrored, line: axis });
  }
  for (const [original, mirrored] of copy.curves) {
    if (sketch.entities.find((entity) => entity.id === original)?.type === 'circle') builder.relation({ type: 'equal', a: original, b: mirrored });
  }
  return { ok: true, sketch: builder.build() };
}

/** Equal relations between round originals and their copies (hole patterns keep one size). */
function equalRounds(sketch: SketchData, builder: SketchBuilder, curves: Map<string, string>): void {
  for (const [original, copy] of curves) {
    const type = sketch.entities.find((entity) => entity.id === original)?.type;
    if (type === 'circle' || type === 'arc') builder.relation({ type: 'equal', a: original, b: copy });
  }
}

/** `count` instances in total (the selection plus count − 1 copies), each shifted by `step`. */
export function linearPattern(sketch: SketchData, ids: readonly string[], step: Point2, count: number): TransformResult {
  const geometry = selectedGeometry(sketch, ids);
  if (geometry.curves.length === 0 && geometry.points.size === 0) return { ok: false, error: 'nothing-selected' };
  const builder = new SketchBuilder(sketch);
  for (let k = 1; k < Math.max(1, Math.round(count)); k++) {
    const copy = copyGeometry(sketch, builder, geometry, ([x, y]) => [x + step[0] * k, y + step[1] * k]);
    equalRounds(sketch, builder, copy.curves);
  }
  return { ok: true, sketch: builder.build() };
}

/** `count` instances evenly spread over `sweep` radians (a full circle: no instance on top of the first). */
export function circularPattern(sketch: SketchData, ids: readonly string[], center: Point2, count: number, sweep = 2 * Math.PI): TransformResult {
  const geometry = selectedGeometry(sketch, ids);
  if (geometry.curves.length === 0 && geometry.points.size === 0) return { ok: false, error: 'nothing-selected' };
  const instances = Math.max(1, Math.round(count));
  const full = Math.abs(Math.abs(sweep) - 2 * Math.PI) < 1e-9;
  const step = full ? sweep / instances : sweep / Math.max(1, instances - 1);
  const builder = new SketchBuilder(sketch);
  for (let k = 1; k < instances; k++) {
    const angle = step * k;
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    const rotate: Transform = ([x, y]) => [center[0] + (x - center[0]) * cos - (y - center[1]) * sin, center[1] + (x - center[0]) * sin + (y - center[1]) * cos];
    const copy = copyGeometry(sketch, builder, geometry, rotate, { keep: (id) => id === ORIGIN_ID && center[0] === 0 && center[1] === 0 });
    equalRounds(sketch, builder, copy.curves);
  }
  return { ok: true, sketch: builder.build() };
}

/** A plain copy of the selection, shifted by `offset` and rotated by `angle` around `pivot`. */
export function copySelection(sketch: SketchData, ids: readonly string[], offset: Point2, angle = 0, pivot: Point2 = [0, 0]): TransformResult {
  const geometry = selectedGeometry(sketch, ids);
  if (geometry.curves.length === 0 && geometry.points.size === 0) return { ok: false, error: 'nothing-selected' };
  const builder = new SketchBuilder(sketch);
  copyGeometry(sketch, builder, geometry, transformOf(offset, angle, pivot));
  return { ok: true, sketch: builder.build() };
}

/** Rotation around `pivot`, then a shift. */
export function transformOf(offset: Point2, angle: number, pivot: Point2): Transform {
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  return ([x, y]) => [pivot[0] + (x - pivot[0]) * cos - (y - pivot[1]) * sin + offset[0], pivot[1] + (x - pivot[0]) * sin + (y - pivot[1]) * cos + offset[1]];
}

/** Where every point of the selection should go when it is moved (the solver then honors the relations). */
export function movedPoints(sketch: SketchData, ids: readonly string[], offset: Point2, angle = 0, pivot: Point2 = [0, 0]): { id: string; x: number; y: number }[] {
  const positions = pointPositions(sketch);
  const transform = transformOf(offset, angle, pivot);
  return [...selectedGeometry(sketch, ids).points].flatMap((id) => {
    const at = positions.get(id);
    if (!at || id === ORIGIN_ID) return [];
    const [x, y] = transform(at);
    return [{ id, x, y }];
  });
}
