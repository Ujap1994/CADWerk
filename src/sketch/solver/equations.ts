import { isDimension, ORIGIN_ID, type SketchConstraint, type SketchEntity } from '../../shared/model/sketch.ts';

/**
 * Translates a sketch into parameters and equations.
 *
 * Parameters: x/y of every point, the radius of every circle (arcs derive their radius
 * from center and start point). Each equation is a residual over at most a handful of
 * parameters that is zero when its constraint holds.
 */

export interface Equation {
  /** Owning constraint id, or `arc:<id>` for the implicit rule of an arc. */
  owner: string;
  /** Global parameter indices used by `residual`, in order. */
  params: number[];
  /** Residual in millimeters (dimensionless relations are scaled by the sketch size). */
  residual(values: Float64Array): number;
}

export interface SketchSystem {
  values: Float64Array;
  fixed: Uint8Array;
  equations: Equation[];
  pointParams: Map<string, [number, number]>;
  radiusParam: Map<string, number>;
  entityParams: Map<string, number[]>;
  /** Reference length used to scale angular residuals. */
  scale: number;
  /** Constraints whose references are missing or unsupported (reported, not solved). */
  invalid: string[];
}

class Builder {
  readonly values: number[] = [];
  readonly fixed: number[] = [];

  add(value: number, fixed = false): number {
    this.values.push(value);
    this.fixed.push(fixed ? 1 : 0);
    return this.values.length - 1;
  }
}

function lengthOf(x: number, y: number): number {
  return Math.hypot(x, y);
}

/** Wraps an angle into (-π, π]. */
export function wrapAngle(angle: number): number {
  let a = angle % (2 * Math.PI);
  if (a <= -Math.PI) a += 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

export function buildSystem(entities: readonly SketchEntity[], constraints: readonly SketchConstraint[]): SketchSystem {
  const builder = new Builder();
  const pointParams = new Map<string, [number, number]>();
  const radiusParam = new Map<string, number>();
  const entityParams = new Map<string, number[]>();
  const byId = new Map(entities.map((entity) => [entity.id, entity]));

  pointParams.set(ORIGIN_ID, [builder.add(0, true), builder.add(0, true)]);
  for (const entity of entities) {
    if (entity.type === 'point') pointParams.set(entity.id, [builder.add(entity.x), builder.add(entity.y)]);
  }
  for (const entity of entities) {
    if (entity.type === 'circle') radiusParam.set(entity.id, builder.add(entity.radius));
  }

  // Fixed points lose their degrees of freedom instead of getting equations.
  for (const constraint of constraints) {
    if (constraint.type !== 'fix') continue;
    const params = pointParams.get(constraint.point);
    if (params) params.forEach((index) => (builder.fixed[index] = 1));
  }

  const point = (id: string) => pointParams.get(id);
  for (const entity of entities) {
    if (entity.type === 'point') entityParams.set(entity.id, [...(pointParams.get(entity.id) ?? [])]);
    else if (entity.type === 'line') entityParams.set(entity.id, [...(point(entity.p1) ?? []), ...(point(entity.p2) ?? [])]);
    else if (entity.type === 'circle') entityParams.set(entity.id, [...(point(entity.center) ?? []), radiusParam.get(entity.id) ?? -1]);
    else if (entity.type === 'ellipse') entityParams.set(entity.id, [...(point(entity.center) ?? []), ...(point(entity.major) ?? []), ...(point(entity.minor) ?? [])]);
    // A spline has no parameters of its own: it follows its fit points.
    else if (entity.type === 'spline') entityParams.set(entity.id, entity.points.flatMap((id) => point(id) ?? []));
    else entityParams.set(entity.id, [...(point(entity.center) ?? []), ...(point(entity.start) ?? []), ...(point(entity.end) ?? [])]);
  }

  // Reference length: the size of the sketch, so relations weigh like millimeters.
  let maxCoordinate = 1;
  for (const entity of entities) {
    if (entity.type === 'point') maxCoordinate = Math.max(maxCoordinate, Math.abs(entity.x), Math.abs(entity.y));
    if (entity.type === 'circle') maxCoordinate = Math.max(maxCoordinate, entity.radius);
  }
  const scale = maxCoordinate;

  const equations: Equation[] = [];
  const invalid: string[] = [];

  // ----- accessors for geometry inside residuals
  type Line = { a: [number, number]; b: [number, number] };
  type Round = { center: [number, number]; radius: number | null; start?: [number, number] };
  const lineOf = (id: string): Line | null => {
    const entity = byId.get(id);
    if (entity?.type !== 'line') return null;
    const a = point(entity.p1);
    const b = point(entity.p2);
    return a && b ? { a, b } : null;
  };
  const roundOf = (id: string): Round | null => {
    const entity = byId.get(id);
    if (entity?.type === 'circle') {
      const center = point(entity.center);
      const radius = radiusParam.get(entity.id);
      return center && radius !== undefined ? { center, radius } : null;
    }
    if (entity?.type === 'arc') {
      const center = point(entity.center);
      const start = point(entity.start);
      return center && start ? { center, radius: null, start } : null;
    }
    return null;
  };

  /** Center and axis points of an ellipse, as parameter pairs. */
  const ellipseOf = (id: string): [number, number][] | null => {
    const entity = byId.get(id);
    if (entity?.type !== 'ellipse') return null;
    const c = point(entity.center);
    const major = point(entity.major);
    const minor = point(entity.minor);
    return c && major && minor ? [c, major, minor] : null;
  };

  /** End points of lines and arcs (circles have none). */
  const endPoints = (id: string): string[] => {
    const entity = byId.get(id);
    return entity?.type === 'line' ? [entity.p1, entity.p2] : entity?.type === 'arc' ? [entity.start, entity.end] : [];
  };
  /** A point where two curves meet end to end, if any. */
  const sharedEndPoint = (a: string, b: string): string | undefined => {
    const ends = endPoints(b);
    return endPoints(a).find((end) => ends.includes(end));
  };

  /** Adds an equation; `fn` receives the local parameter values in the order of `params`. */
  const add = (owner: string, params: number[], fn: (v: Float64Array) => number) => {
    const local = new Float64Array(params.length);
    equations.push({
      owner,
      params,
      residual(values: Float64Array) {
        for (let i = 0; i < params.length; i++) local[i] = values[params[i] as number] as number;
        return fn(local);
      },
    });
  };

  const roundParams = (round: Round): number[] =>
    round.radius !== null ? [...round.center, round.radius] : [...round.center, ...(round.start as [number, number])];
  /** Radius from local values laid out like roundParams(), starting at `offset`. */
  const radiusAt = (round: Round, v: Float64Array, offset: number): number =>
    round.radius !== null
      ? (v[offset + 2] as number)
      : lengthOf((v[offset + 2] as number) - (v[offset] as number), (v[offset + 3] as number) - (v[offset + 1] as number));

  // Implicit arc rule: start and end are equally far from the center.
  for (const entity of entities) {
    if (entity.type !== 'arc') continue;
    const c = point(entity.center);
    const s = point(entity.start);
    const e = point(entity.end);
    if (!c || !s || !e) continue;
    add(`arc:${entity.id}`, [...c, ...s, ...e], (v) => {
      const rs = lengthOf((v[2] as number) - (v[0] as number), (v[3] as number) - (v[1] as number));
      const re = lengthOf((v[4] as number) - (v[0] as number), (v[5] as number) - (v[1] as number));
      return rs - re;
    });
  }

  // Implicit ellipse rule: the two axes are perpendicular.
  for (const entity of entities) {
    if (entity.type !== 'ellipse') continue;
    const ellipse = ellipseOf(entity.id);
    if (!ellipse) continue;
    add(`ellipse:${entity.id}`, ellipse.flat(), (v) => {
      const ax = (v[2] as number) - (v[0] as number), ay = (v[3] as number) - (v[1] as number);
      const bx = (v[4] as number) - (v[0] as number), by = (v[5] as number) - (v[1] as number);
      return (ax * bx + ay * by) / Math.max(lengthOf(ax, ay), 1e-12);
    });
  }
  /**
   * Local layout of an ellipse's values (center, major, minor from `offset`): its semi-axes and the
   * unit vector of the major axis.
   */
  const ellipseAt = (v: Float64Array, offset: number) => {
    const cx = v[offset] as number, cy = v[offset + 1] as number;
    const ax = (v[offset + 2] as number) - cx, ay = (v[offset + 3] as number) - cy;
    const a = Math.max(lengthOf(ax, ay), 1e-12);
    const b = Math.max(lengthOf((v[offset + 4] as number) - cx, (v[offset + 5] as number) - cy), 1e-12);
    return { cx, cy, a, b, ux: ax / a, uy: ay / a };
  };

  for (const constraint of constraints) {
    const id = constraint.id;
    if (isDimension(constraint) && !constraint.driving) continue;
    switch (constraint.type) {
      case 'fix':
        break;
      case 'coincident':
      case 'horizontalPoints':
      case 'verticalPoints': {
        const a = point(constraint.a);
        const b = point(constraint.b);
        if (!a || !b) {
          invalid.push(id);
          break;
        }
        if (constraint.type !== 'verticalPoints') add(id, [a[1], b[1]], (v) => (v[0] as number) - (v[1] as number));
        if (constraint.type !== 'horizontalPoints') add(id, [a[0], b[0]], (v) => (v[0] as number) - (v[1] as number));
        break;
      }
      case 'horizontal':
      case 'vertical': {
        const line = lineOf(constraint.line);
        if (!line) {
          invalid.push(id);
          break;
        }
        const axis = constraint.type === 'horizontal' ? 1 : 0;
        add(id, [line.a[axis], line.b[axis]], (v) => (v[0] as number) - (v[1] as number));
        break;
      }
      case 'parallel':
      case 'perpendicular':
      case 'collinear': {
        const l1 = lineOf(constraint.a);
        const l2 = lineOf(constraint.b);
        if (!l1 || !l2) {
          invalid.push(id);
          break;
        }
        const perpendicular = constraint.type === 'perpendicular';
        add(id, [...l1.a, ...l1.b, ...l2.a, ...l2.b], (v) => {
          const d1x = (v[2] as number) - (v[0] as number), d1y = (v[3] as number) - (v[1] as number);
          const d2x = (v[6] as number) - (v[4] as number), d2y = (v[7] as number) - (v[5] as number);
          const norm = Math.max(lengthOf(d1x, d1y) * lengthOf(d2x, d2y), 1e-12);
          return (perpendicular ? d1x * d2x + d1y * d2y : d1x * d2y - d1y * d2x) / norm * scale;
        });
        if (constraint.type === 'collinear') {
          add(id, [...l1.a, ...l1.b, ...l2.a], (v) => {
            const dx = (v[2] as number) - (v[0] as number), dy = (v[3] as number) - (v[1] as number);
            return (dx * ((v[5] as number) - (v[1] as number)) - dy * ((v[4] as number) - (v[0] as number))) / Math.max(lengthOf(dx, dy), 1e-12);
          });
        }
        break;
      }
      case 'tangent': {
        const lineA = lineOf(constraint.a);
        const lineB = lineOf(constraint.b);
        const roundA = roundOf(constraint.a);
        const roundB = roundOf(constraint.b);
        // Curves that touch at a shared end point get a form that is well conditioned there: the
        // distance form has a double root at the touching point, which leaves the point free to
        // first order (the analysis would report it as under-defined).
        const shared = sharedEndPoint(constraint.a, constraint.b);
        const touch = shared ? point(shared) : undefined;
        if ((lineA || lineB) && (roundA || roundB) && touch) {
          const line = (lineA ?? lineB) as Line;
          const round = (roundA ?? roundB) as Round;
          // The radius to the touching point is perpendicular to the line.
          add(id, [...line.a, ...line.b, ...round.center, ...touch], (v) => {
            const dx = (v[2] as number) - (v[0] as number), dy = (v[3] as number) - (v[1] as number);
            return (dx * ((v[6] as number) - (v[4] as number)) + dy * ((v[7] as number) - (v[5] as number))) / Math.max(lengthOf(dx, dy), 1e-12);
          });
        } else if (roundA && roundB && touch) {
          // Both centers and the touching point lie on one line.
          add(id, [...roundA.center, ...roundB.center, ...touch], (v) => {
            const ax = (v[0] as number) - (v[4] as number), ay = (v[1] as number) - (v[5] as number);
            const bx = (v[2] as number) - (v[4] as number), by = (v[3] as number) - (v[5] as number);
            return (ax * by - ay * bx) / Math.max(lengthOf(ax, ay), 1e-12);
          });
        } else if ((lineA || lineB) && (ellipseOf(constraint.a) || ellipseOf(constraint.b))) {
          const line = (lineA ?? lineB) as Line;
          const ellipse = (ellipseOf(constraint.a) ?? ellipseOf(constraint.b)) as [number, number][];
          // The line's distance from the center equals the ellipse's extent in the line's normal direction.
          add(id, [...line.a, ...line.b, ...ellipse.flat()], (v) => {
            const dx = (v[2] as number) - (v[0] as number), dy = (v[3] as number) - (v[1] as number);
            const length = Math.max(lengthOf(dx, dy), 1e-12);
            const nx = -dy / length, ny = dx / length;
            const e = ellipseAt(v, 4);
            const along = nx * e.ux + ny * e.uy;
            const across = ny * e.ux - nx * e.uy;
            const distance = nx * (e.cx - (v[0] as number)) + ny * (e.cy - (v[1] as number));
            return Math.abs(distance) - lengthOf(e.a * along, e.b * across);
          });
        } else if ((lineA || lineB) && (roundA || roundB)) {
          const line = (lineA ?? lineB) as Line;
          const round = (roundA ?? roundB) as Round;
          add(id, [...line.a, ...line.b, ...roundParams(round)], (v) => {
            const dx = (v[2] as number) - (v[0] as number), dy = (v[3] as number) - (v[1] as number);
            const distance = (dx * ((v[5] as number) - (v[1] as number)) - dy * ((v[4] as number) - (v[0] as number))) / Math.max(lengthOf(dx, dy), 1e-12);
            return Math.abs(distance) - radiusAt(round, v, 4);
          });
        } else if (roundA && roundB) {
          const n = roundParams(roundA).length;
          const inner = constraint.inner === true;
          add(id, [...roundParams(roundA), ...roundParams(roundB)], (v) => {
            const r1 = radiusAt(roundA, v, 0);
            const r2 = radiusAt(roundB, v, n);
            const centers = lengthOf((v[n] as number) - (v[0] as number), (v[n + 1] as number) - (v[1] as number));
            return centers - (inner ? Math.abs(r1 - r2) : r1 + r2);
          });
        } else {
          invalid.push(id);
        }
        break;
      }
      case 'equal': {
        const l1 = lineOf(constraint.a);
        const l2 = lineOf(constraint.b);
        const r1 = roundOf(constraint.a);
        const r2 = roundOf(constraint.b);
        if (l1 && l2) {
          add(id, [...l1.a, ...l1.b, ...l2.a, ...l2.b], (v) =>
            lengthOf((v[2] as number) - (v[0] as number), (v[3] as number) - (v[1] as number)) -
            lengthOf((v[6] as number) - (v[4] as number), (v[7] as number) - (v[5] as number)),
          );
        } else if (r1 && r2) {
          const n = roundParams(r1).length;
          add(id, [...roundParams(r1), ...roundParams(r2)], (v) => radiusAt(r1, v, 0) - radiusAt(r2, v, n));
        } else {
          invalid.push(id);
        }
        break;
      }
      case 'concentric': {
        const r1 = roundOf(constraint.a);
        const r2 = roundOf(constraint.b);
        if (!r1 || !r2) {
          invalid.push(id);
          break;
        }
        if (r1.center === r2.center) break;
        add(id, [r1.center[0], r2.center[0]], (v) => (v[0] as number) - (v[1] as number));
        add(id, [r1.center[1], r2.center[1]], (v) => (v[0] as number) - (v[1] as number));
        break;
      }
      case 'midpoint': {
        const p = point(constraint.point);
        const line = lineOf(constraint.line);
        if (!p || !line) {
          invalid.push(id);
          break;
        }
        add(id, [p[0], line.a[0], line.b[0]], (v) => (v[0] as number) - ((v[1] as number) + (v[2] as number)) / 2);
        add(id, [p[1], line.a[1], line.b[1]], (v) => (v[0] as number) - ((v[1] as number) + (v[2] as number)) / 2);
        break;
      }
      case 'pointOnLine': {
        const p = point(constraint.point);
        const line = lineOf(constraint.line);
        if (!p || !line) {
          invalid.push(id);
          break;
        }
        add(id, [...line.a, ...line.b, ...p], (v) => {
          const dx = (v[2] as number) - (v[0] as number), dy = (v[3] as number) - (v[1] as number);
          return (dx * ((v[5] as number) - (v[1] as number)) - dy * ((v[4] as number) - (v[0] as number))) / Math.max(lengthOf(dx, dy), 1e-12);
        });
        break;
      }
      case 'pointOnCircle': {
        const p = point(constraint.point);
        const ellipse = ellipseOf(constraint.circle);
        if (p && ellipse) {
          // How far the point is from the ellipse along the ray from the center (in mm).
          add(id, [...ellipse.flat(), ...p], (v) => {
            const e = ellipseAt(v, 0);
            const dx = (v[6] as number) - e.cx, dy = (v[7] as number) - e.cy;
            const x = (dx * e.ux + dy * e.uy) / e.a;
            const y = (dy * e.ux - dx * e.uy) / e.b;
            const scaled = lengthOf(x, y);
            return scaled > 1e-12 ? lengthOf(dx, dy) * (1 - 1 / scaled) : -Math.min(e.a, e.b);
          });
          break;
        }
        const round = roundOf(constraint.circle);
        if (!p || !round) {
          invalid.push(id);
          break;
        }
        add(id, [...roundParams(round), ...p], (v) => {
          const n = round.radius !== null ? 3 : 4;
          return lengthOf((v[n] as number) - (v[0] as number), (v[n + 1] as number) - (v[1] as number)) - radiusAt(round, v, 0);
        });
        break;
      }
      case 'symmetric': {
        const a = point(constraint.a);
        const b = point(constraint.b);
        const line = lineOf(constraint.line);
        if (!a || !b || !line) {
          invalid.push(id);
          break;
        }
        const params = [...line.a, ...line.b, ...a, ...b];
        // The midpoint of a-b lies on the line ...
        add(id, params, (v) => {
          const dx = (v[2] as number) - (v[0] as number), dy = (v[3] as number) - (v[1] as number);
          const mx = ((v[4] as number) + (v[6] as number)) / 2, my = ((v[5] as number) + (v[7] as number)) / 2;
          return (dx * (my - (v[1] as number)) - dy * (mx - (v[0] as number))) / Math.max(lengthOf(dx, dy), 1e-12);
        });
        // ... and a-b is perpendicular to it.
        add(id, params, (v) => {
          const dx = (v[2] as number) - (v[0] as number), dy = (v[3] as number) - (v[1] as number);
          return (dx * ((v[6] as number) - (v[4] as number)) + dy * ((v[7] as number) - (v[5] as number))) / Math.max(lengthOf(dx, dy), 1e-12);
        });
        break;
      }
      case 'distance': {
        const value = constraint.value;
        const pa = point(constraint.a);
        const pb = point(constraint.b);
        const la = lineOf(constraint.a);
        const lb = lineOf(constraint.b);
        if (pa && pb) {
          add(id, [...pa, ...pb], (v) => lengthOf((v[2] as number) - (v[0] as number), (v[3] as number) - (v[1] as number)) - value);
        } else if ((pa && lb) || (pb && la)) {
          const p = (pa ?? pb) as [number, number];
          const line = (lb ?? la) as Line;
          add(id, [...line.a, ...line.b, ...p], (v) => {
            const dx = (v[2] as number) - (v[0] as number), dy = (v[3] as number) - (v[1] as number);
            const distance = (dx * ((v[5] as number) - (v[1] as number)) - dy * ((v[4] as number) - (v[0] as number))) / Math.max(lengthOf(dx, dy), 1e-12);
            return Math.abs(distance) - value;
          });
        } else if (la && lb) {
          // Distance between (parallel) lines: from the second line's start point to the first line.
          add(id, [...la.a, ...la.b, ...lb.a], (v) => {
            const dx = (v[2] as number) - (v[0] as number), dy = (v[3] as number) - (v[1] as number);
            const distance = (dx * ((v[5] as number) - (v[1] as number)) - dy * ((v[4] as number) - (v[0] as number))) / Math.max(lengthOf(dx, dy), 1e-12);
            return Math.abs(distance) - value;
          });
        } else {
          invalid.push(id);
        }
        break;
      }
      case 'horizontalDistance':
      case 'verticalDistance': {
        const a = point(constraint.a);
        const b = point(constraint.b);
        if (!a || !b) {
          invalid.push(id);
          break;
        }
        const axis = constraint.type === 'horizontalDistance' ? 0 : 1;
        const value = constraint.value;
        add(id, [a[axis], b[axis]], (v) => Math.abs((v[1] as number) - (v[0] as number)) - value);
        break;
      }
      case 'radius':
      case 'diameter': {
        const round = roundOf(constraint.circle);
        if (!round) {
          invalid.push(id);
          break;
        }
        const factor = constraint.type === 'diameter' ? 2 : 1;
        const value = constraint.value;
        add(id, roundParams(round), (v) => factor * radiusAt(round, v, 0) - value);
        break;
      }
      case 'angle': {
        const l1 = lineOf(constraint.a);
        const l2 = lineOf(constraint.b);
        if (!l1 || !l2) {
          invalid.push(id);
          break;
        }
        const value = constraint.value;
        add(id, [...l1.a, ...l1.b, ...l2.a, ...l2.b], (v) => {
          const d1x = (v[2] as number) - (v[0] as number), d1y = (v[3] as number) - (v[1] as number);
          const d2x = (v[6] as number) - (v[4] as number), d2y = (v[7] as number) - (v[5] as number);
          return wrapAngle(Math.atan2(d1x * d2y - d1y * d2x, d1x * d2x + d1y * d2y) - value) * scale;
        });
        break;
      }
    }
  }

  return {
    values: Float64Array.from(builder.values),
    fixed: Uint8Array.from(builder.fixed),
    equations,
    pointParams,
    radiusParam,
    entityParams,
    scale,
    invalid,
  };
}
