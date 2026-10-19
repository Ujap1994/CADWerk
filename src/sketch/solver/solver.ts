import type { Equation, SketchSystem } from './equations.ts';
import { multiplyTranspose, solveNormal, type SparseRows } from './linalg.ts';

/**
 * Moves the free parameters onto the constraint manifold with the smallest change:
 * repeated weighted minimum-norm Gauss–Newton steps Δ = −W⁻¹Jᵀ(JW⁻¹Jᵀ + μI)⁻¹ r.
 *
 * Dragging sets target values for some parameters and gives them a high weight, so
 * the constraints are satisfied by moving the *other* free parameters where possible.
 * Under-defined geometry follows the cursor; fully defined geometry springs back.
 */

export interface SolveOptions {
  /** Target values for parameters (e.g. the dragged point), applied before solving. */
  targets?: Map<number, number>;
  maxIterations?: number;
}

export interface Component {
  /** Free parameter indices (global). */
  params: number[];
  equations: Equation[];
}

export interface SolveResult {
  values: Float64Array;
  converged: boolean;
  iterations: number;
  /** Constraint ids whose equations could not be satisfied (conflicting). */
  unsatisfied: string[];
}

/** Weight of parameters with a target: they move ~1000× less than others. */
const TARGET_WEIGHT = 1000;

export function tolerance(system: SketchSystem): number {
  return 1e-9 * Math.max(1, system.scale);
}

/** Groups free parameters that share equations; each group can be solved on its own. */
export function components(system: SketchSystem): Component[] {
  const parent = new Map<number, number>();
  const find = (i: number): number => {
    let root = i;
    while (parent.get(root) !== root) root = parent.get(root) as number;
    let node = i;
    while (parent.get(node) !== root) {
      const next = parent.get(node) as number;
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (let i = 0; i < system.values.length; i++) if (!system.fixed[i]) parent.set(i, i);
  for (const equation of system.equations) {
    const free = equation.params.filter((p) => !system.fixed[p]);
    for (let k = 1; k < free.length; k++) union(free[0] as number, free[k] as number);
  }
  const groups = new Map<number, Component>();
  for (const i of parent.keys()) {
    const root = find(i);
    let group = groups.get(root);
    if (!group) groups.set(root, (group = { params: [], equations: [] }));
    group.params.push(i);
  }
  for (const equation of system.equations) {
    const free = equation.params.find((p) => !system.fixed[p]);
    if (free === undefined) continue;
    groups.get(find(free))?.equations.push(equation);
  }
  return [...groups.values()];
}

/** Residuals and the sparse Jacobian (central differences on the free local parameters). */
export function linearize(component: Component, values: Float64Array, fixed: Uint8Array): { J: SparseRows; residuals: Float64Array } {
  const column = new Map<number, number>();
  component.params.forEach((param, index) => column.set(param, index));
  const m = component.equations.length;
  const residuals = new Float64Array(m);
  const rowColumns: Int32Array[] = [];
  const rowValues: Float64Array[] = [];
  for (let r = 0; r < m; r++) {
    const equation = component.equations[r] as Equation;
    residuals[r] = equation.residual(values);
    const cols: number[] = [];
    const vals: number[] = [];
    for (const param of equation.params) {
      if (fixed[param]) continue;
      const original = values[param] as number;
      const h = 1e-7 * Math.max(1, Math.abs(original));
      values[param] = original + h;
      const plus = equation.residual(values);
      values[param] = original - h;
      const minus = equation.residual(values);
      values[param] = original;
      const derivative = (plus - minus) / (2 * h);
      const c = column.get(param) as number;
      const existing = cols.indexOf(c);
      if (existing >= 0) vals[existing] = (vals[existing] as number) + derivative;
      else {
        cols.push(c);
        vals.push(derivative);
      }
    }
    rowColumns.push(Int32Array.from(cols));
    rowValues.push(Float64Array.from(vals));
  }
  return { J: { columns: component.params.length, rowColumns, rowValues }, residuals };
}

function squaredNorm(v: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += (v[i] as number) ** 2;
  return sum;
}

function maxAbs(v: Float64Array): number {
  let max = 0;
  for (let i = 0; i < v.length; i++) max = Math.max(max, Math.abs(v[i] as number));
  return max;
}

function evaluate(component: Component, values: Float64Array, out: Float64Array): Float64Array {
  for (let r = 0; r < component.equations.length; r++) out[r] = (component.equations[r] as Equation).residual(values);
  return out;
}

/** Solves one component in place; returns [converged, iterations]. */
function solveComponent(component: Component, system: SketchSystem, values: Float64Array, targets: Map<number, number>, maxIterations: number): [boolean, number] {
  const tol = tolerance(system);
  const invWeights = Float64Array.from(component.params, (param) => (targets.has(param) ? 1 / TARGET_WEIGHT : 1));
  const trial = new Float64Array(component.equations.length);
  const step = new Float64Array(component.params.length);
  // Limit single steps to the sketch size, so a bad linearization cannot fling geometry away.
  const maxStep = 2 * Math.max(1, system.scale);
  let mu = 1e-10;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const { J, residuals } = linearize(component, values, system.fixed);
    if (maxAbs(residuals) < tol) return [true, iteration];
    const y = solveNormal(J, invWeights, mu, residuals);
    multiplyTranspose(J, y, step);
    let length = 0;
    for (let i = 0; i < step.length; i++) {
      step[i] = -(step[i] as number) * (invWeights[i] as number);
      length = Math.max(length, Math.abs(step[i] as number));
    }
    const clamp = length > maxStep ? maxStep / length : 1;

    // Backtracking line search on the squared residual.
    const before = squaredNorm(residuals);
    const original = component.params.map((param) => values[param] as number);
    let accepted = false;
    for (let alpha = clamp; alpha > 1e-4; alpha /= 2) {
      component.params.forEach((param, i) => (values[param] = (original[i] as number) + alpha * (step[i] as number)));
      if (squaredNorm(evaluate(component, values, trial)) < before) {
        accepted = true;
        break;
      }
    }
    if (!accepted) {
      component.params.forEach((param, i) => (values[param] = original[i] as number));
      mu = mu * 100;
      if (mu > 1e6) return [false, iteration];
    } else {
      mu = Math.max(mu / 10, 1e-12);
    }
  }
  const { residuals } = linearize(component, values, system.fixed);
  return [maxAbs(residuals) < tol, maxIterations];
}

export function solve(system: SketchSystem, options: SolveOptions = {}): SolveResult {
  const values = system.values.slice();
  const targets = new Map<number, number>();
  for (const [param, value] of options.targets ?? []) {
    if (system.fixed[param]) continue;
    targets.set(param, value);
    values[param] = value;
  }
  const maxIterations = options.maxIterations ?? 100;
  const tol = tolerance(system);
  let converged = true;
  let iterations = 0;

  for (const component of components(system)) {
    if (component.equations.length === 0) continue;
    const touched = component.params.some((param) => targets.has(param));
    const residuals = evaluate(component, values, new Float64Array(component.equations.length));
    if (!touched && maxAbs(residuals) < tol) continue;
    const [ok, count] = solveComponent(component, system, values, targets, maxIterations);
    iterations = Math.max(iterations, count);
    if (!ok) converged = false;
  }

  const unsatisfied = new Set<string>();
  for (const equation of system.equations) {
    if (Math.abs(equation.residual(values)) > tol * 10) unsatisfied.add(equation.owner);
  }
  return { values, converged: converged && unsatisfied.size === 0, iterations, unsatisfied: [...unsatisfied] };
}
