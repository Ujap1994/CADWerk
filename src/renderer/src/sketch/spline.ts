/**
 * Splines through points: a natural cubic spline (C2, no bending at its ends) parameterized by chord
 * length. The fit points are ordinary sketch points, so they snap, take relations and dimensions and
 * are moved by the solver; the curve follows from them.
 */

import type { Point2 } from './geometry.ts';

export interface SplineGeometry {
  /** The fit points without consecutive duplicates. */
  points: Point2[];
  /** Parameter (cumulative chord length) at each point. */
  knots: number[];
  /** Second derivatives at each point, per coordinate. */
  second: Point2[];
}

/** Second derivatives of a natural cubic spline through values y at parameters t (tridiagonal solve). */
function naturalSecondDerivatives(t: readonly number[], y: readonly number[]): number[] {
  const n = t.length - 1;
  const m = new Array<number>(n + 1).fill(0);
  if (n < 2) return m;
  // Thomas algorithm for the interior equations; the ends have m = 0.
  const diagonal = new Array<number>(n + 1).fill(0);
  const right = new Array<number>(n + 1).fill(0);
  const upper = new Array<number>(n + 1).fill(0);
  for (let i = 1; i < n; i++) {
    const h0 = (t[i] as number) - (t[i - 1] as number);
    const h1 = (t[i + 1] as number) - (t[i] as number);
    diagonal[i] = 2 * (h0 + h1);
    upper[i] = h1;
    right[i] = 6 * (((y[i + 1] as number) - (y[i] as number)) / h1 - ((y[i] as number) - (y[i - 1] as number)) / h0);
    if (i > 1) {
      const factor = h0 / (diagonal[i - 1] as number);
      diagonal[i] = (diagonal[i] as number) - factor * (upper[i - 1] as number);
      right[i] = (right[i] as number) - factor * (right[i - 1] as number);
    }
  }
  for (let i = n - 1; i >= 1; i--) m[i] = ((right[i] as number) - (upper[i] as number) * (m[i + 1] as number)) / (diagonal[i] as number);
  return m;
}

export function splineThrough(input: readonly Point2[]): SplineGeometry | null {
  const points: Point2[] = [];
  for (const p of input) {
    const last = points.at(-1);
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-12) points.push(p);
  }
  if (points.length < 2) return null;
  const knots = [0];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1] as Point2, points[i] as Point2];
    knots.push((knots[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const mx = naturalSecondDerivatives(knots, points.map((p) => p[0]));
  const my = naturalSecondDerivatives(knots, points.map((p) => p[1]));
  return { points, knots, second: mx.map((m, i) => [m, my[i] as number]) };
}

/** The point at parameter s (0 … total chord length); clamped to the ends. */
export function splinePoint(spline: SplineGeometry, s: number): Point2 {
  const { points, knots, second } = spline;
  const last = knots.length - 1;
  const at = Math.max(0, Math.min(knots[last] as number, s));
  let i = 0;
  while (i < last - 1 && at > (knots[i + 1] as number)) i++;
  const h = (knots[i + 1] as number) - (knots[i] as number);
  const a = ((knots[i + 1] as number) - at) / h;
  const b = (at - (knots[i] as number)) / h;
  const value = (k: 0 | 1) => {
    const [y0, y1] = [(points[i] as Point2)[k], (points[i + 1] as Point2)[k]];
    const [m0, m1] = [(second[i] as Point2)[k], (second[i + 1] as Point2)[k]];
    return a * y0 + b * y1 + (((a * a * a - a) * m0 + (b * b * b - b) * m1) * h * h) / 6;
  };
  return [value(0), value(1)];
}

/** The spline as a polyline with `perSpan` segments between neighboring fit points. */
export function splinePolyline(spline: SplineGeometry, perSpan: number): Point2[] {
  const result: Point2[] = [spline.points[0] as Point2];
  for (let i = 1; i < spline.knots.length; i++) {
    const [from, to] = [spline.knots[i - 1] as number, spline.knots[i] as number];
    for (let k = 1; k <= perSpan; k++) result.push(k === perSpan ? (spline.points[i] as Point2) : splinePoint(spline, from + ((to - from) * k) / perSpan));
  }
  return result;
}

/**
 * Segments per span that keep the polyline within `tolerance` of the curve: the chord deviation of a
 * cubic is at most h²·|f''|/8 over a span of length h.
 */
export function segmentsPerSpan(spline: SplineGeometry, tolerance: number): number {
  let worst = 1;
  for (let i = 1; i < spline.knots.length; i++) {
    const h = (spline.knots[i] as number) - (spline.knots[i - 1] as number);
    const bend = Math.max(Math.hypot(...(spline.second[i - 1] as Point2)), Math.hypot(...(spline.second[i] as Point2)));
    worst = Math.max(worst, Math.ceil(h * Math.sqrt(bend / (8 * Math.max(tolerance, 1e-12)))));
  }
  return Math.min(256, worst);
}

/** Length of the spline (from a fine polyline). */
export function splineLength(spline: SplineGeometry): number {
  const polyline = splinePolyline(spline, 32);
  let length = 0;
  for (let i = 1; i < polyline.length; i++) length += Math.hypot((polyline[i] as Point2)[0] - (polyline[i - 1] as Point2)[0], (polyline[i] as Point2)[1] - (polyline[i - 1] as Point2)[1]);
  return length;
}
