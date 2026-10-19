/**
 * Minimal sparse linear algebra for the sketch solver.
 *
 * The Jacobian J (one row per equation, a few non-zeros each) is stored row-wise.
 * The solver needs y with (J W⁻¹ Jᵀ + μI) y = b:
 * - small systems: dense Cholesky;
 * - larger systems: the matrix is sparse and, because sketch constraints connect
 *   neighboring geometry, has a small bandwidth after Reverse Cuthill–McKee
 *   reordering, so an envelope (skyline) Cholesky factorization costs close to O(n);
 * - fallback for pathological envelopes: Jacobi-preconditioned conjugate gradients.
 */

export interface SparseRows {
  /** Number of columns (variables). */
  columns: number;
  rowColumns: Int32Array[];
  rowValues: Float64Array[];
}

/** Below this number of rows the dense path is faster and more robust. */
const DENSE_LIMIT = 40;

export function multiply(J: SparseRows, x: Float64Array, out: Float64Array): Float64Array {
  for (let r = 0; r < J.rowColumns.length; r++) {
    const cols = J.rowColumns[r] as Int32Array;
    const vals = J.rowValues[r] as Float64Array;
    let sum = 0;
    for (let k = 0; k < cols.length; k++) sum += (vals[k] as number) * (x[cols[k] as number] as number);
    out[r] = sum;
  }
  return out;
}

export function multiplyTranspose(J: SparseRows, y: Float64Array, out: Float64Array): Float64Array {
  out.fill(0);
  for (let r = 0; r < J.rowColumns.length; r++) {
    const cols = J.rowColumns[r] as Int32Array;
    const vals = J.rowValues[r] as Float64Array;
    const yr = y[r] as number;
    if (yr === 0) continue;
    for (let k = 0; k < cols.length; k++) out[cols[k] as number] = (out[cols[k] as number] as number) + (vals[k] as number) * yr;
  }
  return out;
}

function dot(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] as number) * (b[i] as number);
  return sum;
}

/** In-place Cholesky factorization of a dense SPD matrix (row-major n×n); returns false if not SPD. */
function cholesky(a: Float64Array, n: number): boolean {
  for (let j = 0; j < n; j++) {
    let diagonal = a[j * n + j] as number;
    for (let k = 0; k < j; k++) diagonal -= (a[j * n + k] as number) ** 2;
    if (!(diagonal > 0)) return false;
    const ljj = Math.sqrt(diagonal);
    a[j * n + j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let sum = a[i * n + j] as number;
      for (let k = 0; k < j; k++) sum -= (a[i * n + k] as number) * (a[j * n + k] as number);
      a[i * n + j] = sum / ljj;
    }
  }
  return true;
}

function choleskySolve(l: Float64Array, n: number, b: Float64Array): Float64Array {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i] as number;
    for (let k = 0; k < i; k++) sum -= (l[i * n + k] as number) * (y[k] as number);
    y[i] = sum / (l[i * n + i] as number);
  }
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i] as number;
    for (let k = i + 1; k < n; k++) sum -= (l[k * n + i] as number) * (y[k] as number);
    y[i] = sum / (l[i * n + i] as number);
  }
  return y;
}

function solveDense(J: SparseRows, invWeights: Float64Array, mu: number, b: Float64Array): Float64Array {
  const m = J.rowColumns.length;
  // Scatter each row once into a dense column map for the Gram products.
  const dense = new Float64Array(m * m);
  const columnRows = new Map<number, { row: number; value: number }[]>();
  for (let r = 0; r < m; r++) {
    const cols = J.rowColumns[r] as Int32Array;
    const vals = J.rowValues[r] as Float64Array;
    for (let k = 0; k < cols.length; k++) {
      const c = cols[k] as number;
      let list = columnRows.get(c);
      if (!list) columnRows.set(c, (list = []));
      list.push({ row: r, value: vals[k] as number });
    }
  }
  for (const [column, entries] of columnRows) {
    const w = invWeights[column] as number;
    for (const a of entries) for (const b2 of entries) dense[a.row * m + b2.row] = (dense[a.row * m + b2.row] as number) + a.value * b2.value * w;
  }
  let damping = mu;
  for (let attempt = 0; attempt < 8; attempt++) {
    const a = dense.slice();
    for (let i = 0; i < m; i++) a[i * m + i] = (a[i * m + i] as number) + damping;
    if (cholesky(a, m)) return choleskySolve(a, m, b);
    damping = Math.max(damping * 100, 1e-12);
  }
  return new Float64Array(m);
}

function solveIterative(J: SparseRows, invWeights: Float64Array, mu: number, b: Float64Array): Float64Array {
  const m = J.rowColumns.length;
  const n = J.columns;
  const tmpN = new Float64Array(n);
  const apply = (v: Float64Array, out: Float64Array) => {
    multiplyTranspose(J, v, tmpN);
    for (let i = 0; i < n; i++) tmpN[i] = (tmpN[i] as number) * (invWeights[i] as number);
    multiply(J, tmpN, out);
    for (let i = 0; i < m; i++) out[i] = (out[i] as number) + mu * (v[i] as number);
  };
  const preconditioner = new Float64Array(m);
  for (let r = 0; r < m; r++) {
    const cols = J.rowColumns[r] as Int32Array;
    const vals = J.rowValues[r] as Float64Array;
    let sum = mu;
    for (let k = 0; k < cols.length; k++) sum += (vals[k] as number) ** 2 * (invWeights[cols[k] as number] as number);
    preconditioner[r] = sum > 0 ? 1 / sum : 1;
  }

  const x = new Float64Array(m);
  const r = b.slice();
  const z = new Float64Array(m);
  for (let i = 0; i < m; i++) z[i] = (r[i] as number) * (preconditioner[i] as number);
  const p = z.slice();
  const ap = new Float64Array(m);
  let rz = dot(r, z);
  const tolerance = 1e-24 * Math.max(dot(b, b), 1e-300);
  for (let iteration = 0; iteration < 4 * m + 50; iteration++) {
    apply(p, ap);
    const pap = dot(p, ap);
    if (!(pap > 0)) break;
    const alpha = rz / pap;
    for (let i = 0; i < m; i++) {
      x[i] = (x[i] as number) + alpha * (p[i] as number);
      r[i] = (r[i] as number) - alpha * (ap[i] as number);
    }
    if (dot(r, r) < tolerance) break;
    for (let i = 0; i < m; i++) z[i] = (r[i] as number) * (preconditioner[i] as number);
    const rzNext = dot(r, z);
    const beta = rzNext / rz;
    rz = rzNext;
    for (let i = 0; i < m; i++) p[i] = (z[i] as number) + beta * (p[i] as number);
  }
  return x;
}

/** Upper bound for envelope entries before falling back to conjugate gradients (memory guard). */
const ENVELOPE_LIMIT = 20_000_000;

/** Sparse symmetric A = J W⁻¹ Jᵀ as adjacency rows (diagonal included). */
function gram(J: SparseRows, invWeights: Float64Array): Map<number, number>[] {
  const m = J.rowColumns.length;
  const rows: Map<number, number>[] = Array.from({ length: m }, () => new Map());
  const columnRows: { row: number; value: number }[][] = Array.from({ length: J.columns }, () => []);
  for (let r = 0; r < m; r++) {
    const cols = J.rowColumns[r] as Int32Array;
    const vals = J.rowValues[r] as Float64Array;
    for (let k = 0; k < cols.length; k++) (columnRows[cols[k] as number] as { row: number; value: number }[]).push({ row: r, value: vals[k] as number });
  }
  for (let c = 0; c < J.columns; c++) {
    const entries = columnRows[c] as { row: number; value: number }[];
    const w = invWeights[c] as number;
    for (const a of entries) {
      const row = rows[a.row] as Map<number, number>;
      for (const b of entries) row.set(b.row, (row.get(b.row) ?? 0) + a.value * b.value * w);
    }
  }
  return rows;
}

/** Reverse Cuthill–McKee ordering: returns order[newIndex] = oldIndex. */
function reverseCuthillMcKee(rows: Map<number, number>[]): Int32Array {
  const n = rows.length;
  const degree = rows.map((row) => row.size);
  const visited = new Uint8Array(n);
  const order: number[] = [];
  const byDegree = Array.from({ length: n }, (_, i) => i).sort((a, b) => (degree[a] as number) - (degree[b] as number));
  for (const start of byDegree) {
    if (visited[start]) continue;
    visited[start] = 1;
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const node = queue[head] as number;
      order.push(node);
      const neighbors = [...(rows[node] as Map<number, number>).keys()].filter((k) => !visited[k]);
      neighbors.sort((a, b) => (degree[a] as number) - (degree[b] as number));
      for (const k of neighbors) {
        visited[k] = 1;
        queue.push(k);
      }
    }
  }
  return Int32Array.from(order.reverse());
}

/** Envelope Cholesky; returns null when the envelope is too large or the matrix is not SPD. */
function solveEnvelope(J: SparseRows, invWeights: Float64Array, mu: number, b: Float64Array): Float64Array | null {
  const rows = gram(J, invWeights);
  const n = rows.length;
  const order = reverseCuthillMcKee(rows);
  const position = new Int32Array(n);
  order.forEach((old, index) => (position[old] = index));

  // first[i]: first column of row i inside the envelope (permuted indices).
  const first = new Int32Array(n);
  const offset = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    let min = i;
    for (const col of (rows[order[i] as number] as Map<number, number>).keys()) min = Math.min(min, position[col] as number);
    first[i] = min;
    offset[i + 1] = (offset[i] as number) + (i - min + 1);
  }
  if ((offset[n] as number) > ENVELOPE_LIMIT) return null;

  let damping = mu;
  for (let attempt = 0; attempt < 6; attempt++) {
    // Row i stores columns first[i]..i at offset[i].
    const l = new Float64Array(offset[n] as number);
    for (let i = 0; i < n; i++) {
      for (const [col, value] of rows[order[i] as number] as Map<number, number>) {
        const j = position[col] as number;
        if (j <= i) l[(offset[i] as number) + j - (first[i] as number)] = value;
      }
      l[(offset[i] as number) + i - (first[i] as number)] = (l[(offset[i] as number) + i - (first[i] as number)] as number) + damping;
    }
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const fi = first[i] as number;
      const oi = offset[i] as number;
      for (let j = fi; j <= i; j++) {
        const fj = first[j] as number;
        const oj = offset[j] as number;
        let sum = l[oi + j - fi] as number;
        for (let k = Math.max(fi, fj); k < j; k++) sum -= (l[oi + k - fi] as number) * (l[oj + k - fj] as number);
        if (j < i) {
          l[oi + j - fi] = sum / (l[oj + j - fj] as number);
        } else if (sum > 0) {
          l[oi + i - fi] = Math.sqrt(sum);
        } else {
          ok = false;
        }
      }
    }
    if (!ok) {
      damping = Math.max(damping * 100, 1e-12);
      continue;
    }
    // Forward and back substitution in permuted order.
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const fi = first[i] as number;
      const oi = offset[i] as number;
      let sum = b[order[i] as number] as number;
      for (let k = fi; k < i; k++) sum -= (l[oi + k - fi] as number) * (y[k] as number);
      y[i] = sum / (l[oi + i - fi] as number);
    }
    for (let i = n - 1; i >= 0; i--) {
      const fi = first[i] as number;
      const oi = offset[i] as number;
      y[i] = (y[i] as number) / (l[oi + i - fi] as number);
      const yi = y[i] as number;
      for (let k = fi; k < i; k++) y[k] = (y[k] as number) - (l[oi + k - fi] as number) * yi;
    }
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[order[i] as number] = y[i] as number;
    return x;
  }
  return null;
}

/** Solves (J W⁻¹ Jᵀ + μI) y = b. */
export function solveNormal(J: SparseRows, invWeights: Float64Array, mu: number, b: Float64Array): Float64Array {
  if (J.rowColumns.length <= DENSE_LIMIT) return solveDense(J, invWeights, mu, b);
  return solveEnvelope(J, invWeights, mu, b) ?? solveIterative(J, invWeights, mu, b);
}
