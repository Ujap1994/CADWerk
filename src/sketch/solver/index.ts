import { ORIGIN_ID, type SketchData, type SketchEntity } from '../../shared/model/sketch.ts';
import { analyze, isRedundant, type DefinitionStatus } from './analysis.ts';
import { buildSystem } from './equations.ts';
import { solve } from './solver.ts';

export type { DefinitionStatus } from './analysis.ts';
export { isRedundant };

/** Dragging: move a point, move several points together (a whole line or arc), or change a circle's radius (dragging its edge). */
export type DragTarget =
  | { kind: 'point'; id: string; x: number; y: number }
  | { kind: 'points'; points: { id: string; x: number; y: number }[] }
  | { kind: 'radius'; id: string; radius: number };

export interface SketchSolution {
  /** Geometry after solving (always a complete, valid sketch). */
  sketch: SketchData;
  converged: boolean;
  /** Constraints that cannot be satisfied together (conflicting). */
  unsatisfied: string[];
  /** Constraints with missing references. */
  invalid: string[];
  /** Definition status; skipped while dragging for speed (`analyze: false`). */
  status: { sketch: DefinitionStatus; entities: Record<string, DefinitionStatus> } | null;
  timings: { solveMs: number; analysisMs: number };
}

export interface SolveSketchOptions {
  drag?: DragTarget;
  analyze?: boolean;
}

/**
 * Solves a sketch: applies an optional drag target, satisfies all driving constraints
 * with the smallest change of the geometry and reports the definition status.
 * If the constraints cannot be satisfied, the input geometry is returned unchanged
 * and the conflicting constraints are listed.
 */
export function solveSketch(input: SketchData, options: SolveSketchOptions = {}): SketchSolution {
  const start = performance.now();
  const system = buildSystem(input.entities, input.constraints);
  const targets = new Map<number, number>();
  const drag = options.drag;
  const points = drag?.kind === 'point' ? [drag] : drag?.kind === 'points' ? drag.points : [];
  for (const point of points) {
    const params = system.pointParams.get(point.id);
    if (params) {
      targets.set(params[0], point.x);
      targets.set(params[1], point.y);
    }
  }
  if (drag?.kind === 'radius') {
    const param = system.radiusParam.get(drag.id);
    if (param !== undefined) targets.set(param, Math.max(1e-6, drag.radius));
  }

  const result = solve(system, { targets });
  // Conflicting constraints or a drag that cannot be honored leave the sketch as it was:
  // no jumps and no distorted geometry; the conflicting constraints are reported instead.
  const accept = result.converged;
  const values = accept ? result.values : system.values;
  const solveMs = performance.now() - start;

  const entities: SketchEntity[] = input.entities.map((entity) => {
    if (entity.type === 'point') {
      const params = system.pointParams.get(entity.id);
      return params ? { ...entity, x: values[params[0]] as number, y: values[params[1]] as number } : entity;
    }
    if (entity.type === 'circle') {
      const param = system.radiusParam.get(entity.id);
      return param !== undefined ? { ...entity, radius: Math.abs(values[param] as number) } : entity;
    }
    return entity;
  });

  let status: SketchSolution['status'] = null;
  let analysisMs = 0;
  if (options.analyze !== false) {
    const analysisStart = performance.now();
    const analysis = analyze(input.entities, input.constraints, system, values, result.unsatisfied);
    status = { sketch: analysis.sketch, entities: Object.fromEntries(analysis.entities) };
    analysisMs = performance.now() - analysisStart;
  }

  return {
    sketch: { entities, constraints: input.constraints },
    converged: result.converged,
    unsatisfied: result.unsatisfied,
    invalid: system.invalid,
    status,
    timings: { solveMs, analysisMs },
  };
}

export { ORIGIN_ID };
