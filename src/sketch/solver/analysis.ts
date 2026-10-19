import type { SketchConstraint, SketchEntity } from '../../shared/model/sketch.ts';
import { buildSystem, type SketchSystem } from './equations.ts';
import { multiply, multiplyTranspose, solveNormal } from './linalg.ts';
import { components, linearize, tolerance, type Component } from './solver.ts';

/** under: can still move; full: completely determined; over: involved in conflicting constraints. */
export type DefinitionStatus = 'under' | 'full' | 'over';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
}

/**
 * Marks parameters that the constraints do not determine.
 *
 * A parameter is free exactly when some direction in the null space of J moves it.
 * Projecting random vectors onto the null space (z − Jᵀ(JJᵀ)⁺Jz) gives random
 * combinations of all null-space directions, so a free parameter shows a non-zero
 * component with probability 1; two vectors guard against numerical coincidence.
 */
export function freeParameters(system: SketchSystem, values: Float64Array): Uint8Array {
  const free = new Uint8Array(system.values.length);
  for (const component of components(system)) analyzeComponent(component, system, values, free);
  return free;
}

function analyzeComponent(component: Component, system: SketchSystem, values: Float64Array, free: Uint8Array): void {
  const n = component.params.length;
  if (component.equations.length === 0) {
    component.params.forEach((param) => (free[param] = 1));
    return;
  }
  const { J } = linearize(component, values, system.fixed);
  const ones = new Float64Array(n).fill(1);
  const random = mulberry32(0x5eed + n);
  const projected = new Float64Array(n);
  const jz = new Float64Array(component.equations.length);
  for (let sample = 0; sample < 2; sample++) {
    const z = Float64Array.from({ length: n }, () => random());
    multiply(J, z, jz);
    const y = solveNormal(J, ones, 1e-12, jz);
    multiplyTranspose(J, y, projected);
    for (let i = 0; i < n; i++) {
      if (Math.abs((z[i] as number) - (projected[i] as number)) > 1e-6) free[component.params[i] as number] = 1;
    }
  }
}

export interface Analysis {
  sketch: DefinitionStatus;
  entities: Map<string, DefinitionStatus>;
}

export function analyze(
  entities: readonly SketchEntity[],
  constraints: readonly SketchConstraint[],
  system: SketchSystem,
  values: Float64Array,
  unsatisfied: readonly string[],
): Analysis {
  const free = freeParameters(system, values);
  const over = new Set<string>();
  const byConstraint = new Map(constraints.map((c) => [c.id, c]));
  for (const id of unsatisfied) {
    const constraint = byConstraint.get(id);
    if (constraint) for (const ref of constraintReferences(constraint)) over.add(ref);
    else if (id.startsWith('arc:') || id.startsWith('ellipse:')) over.add(id.slice(id.indexOf(':') + 1));
  }
  const status = new Map<string, DefinitionStatus>();
  let anyUnder = false;
  for (const entity of entities) {
    const params = system.entityParams.get(entity.id) ?? [];
    let value: DefinitionStatus = params.some((param) => free[param]) ? 'under' : 'full';
    if (over.has(entity.id)) value = 'over';
    // Points of an over-defined curve are shown over-defined too.
    status.set(entity.id, value);
    if (value === 'under') anyUnder = true;
  }
  for (const entity of entities) {
    if (entity.type === 'point') continue;
    if (status.get(entity.id) !== 'over') continue;
    const refs =
      entity.type === 'line'
        ? [entity.p1, entity.p2]
        : entity.type === 'circle'
          ? [entity.center]
          : entity.type === 'ellipse'
            ? [entity.center, entity.major, entity.minor]
            : entity.type === 'spline'
              ? entity.points
              : [entity.center, entity.start, entity.end];
    for (const ref of refs) {
      if (status.has(ref)) status.set(ref, 'over');
    }
  }
  const sketch: DefinitionStatus = over.size > 0 || unsatisfied.length > 0 ? 'over' : anyUnder ? 'under' : 'full';
  return { sketch, entities: status };
}

/** Entity ids a constraint refers to. */
export function constraintReferences(constraint: SketchConstraint): string[] {
  switch (constraint.type) {
    case 'horizontal':
    case 'vertical':
      return [constraint.line];
    case 'midpoint':
    case 'pointOnLine':
      return [constraint.point, constraint.line];
    case 'pointOnCircle':
      return [constraint.point, constraint.circle];
    case 'symmetric':
      return [constraint.a, constraint.b, constraint.line];
    case 'fix':
      return [constraint.point];
    case 'radius':
    case 'diameter':
      return [constraint.circle];
    default:
      return [constraint.a, constraint.b];
  }
}

/**
 * Checks whether adding `candidate` would over-define the sketch: its equations are
 * linear combinations of the existing ones at the current geometry. A redundant
 * dimension should become a driven (reference) dimension instead.
 */
export function isRedundant(entities: readonly SketchEntity[], constraints: readonly SketchConstraint[], candidate: SketchConstraint): boolean {
  const combined = buildSystem(entities, [...constraints, candidate]);
  const newEquations = combined.equations.filter((equation) => equation.owner === candidate.id);
  if (newEquations.length === 0) return false;
  // Equations on fixed parameters only add no freedom-removing information at all.
  if (newEquations.every((equation) => equation.params.every((param) => combined.fixed[param]))) return true;
  const tol = tolerance(combined);

  // Redundant when every new Jacobian row is a combination of the existing rows.
  for (const component of components(combined)) {
    const rows = component.equations.filter((equation) => equation.owner === candidate.id);
    if (rows.length === 0) continue;
    const others = component.equations.filter((equation) => equation.owner !== candidate.id);
    if (others.length === 0) return false;
    const { J: baseJ } = linearize({ params: component.params, equations: others }, combined.values, combined.fixed);
    const { J: newJ } = linearize({ params: component.params, equations: rows }, combined.values, combined.fixed);
    const ones = new Float64Array(component.params.length).fill(1);
    for (let r = 0; r < newJ.rowColumns.length; r++) {
      const row = new Float64Array(component.params.length);
      const cols = newJ.rowColumns[r] as Int32Array;
      const vals = newJ.rowValues[r] as Float64Array;
      for (let k = 0; k < cols.length; k++) row[cols[k] as number] = vals[k] as number;
      // Least squares: row ≈ baseJᵀ y.
      const rhs = new Float64Array(baseJ.rowColumns.length);
      multiply(baseJ, row, rhs);
      const y = solveNormal(baseJ, ones, 1e-12, rhs);
      const back = new Float64Array(component.params.length);
      multiplyTranspose(baseJ, y, back);
      let error = 0;
      let norm = 0;
      for (let i = 0; i < row.length; i++) {
        error = Math.max(error, Math.abs((row[i] as number) - (back[i] as number)));
        norm = Math.max(norm, Math.abs(row[i] as number));
      }
      if (error > 1e-6 * Math.max(norm, tol)) return false;
    }
  }
  return true;
}
