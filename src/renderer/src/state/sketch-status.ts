import type { SketchData } from '../../../shared/model/sketch.ts';
import type { DefinitionStatus } from '../../../sketch/solver/index.ts';
import { sketchSolver } from '../sketch/solver.ts';
import { getState, setState, store } from './store.ts';

/** What the solver says about one sketch. */
export interface SketchAnalysis {
  /** The geometry this analysis belongs to (results for older geometry are ignored). */
  sketch: SketchData;
  /** 'under' while something can still move, 'full' when everything is determined, 'over' on conflicts. */
  status: DefinitionStatus;
  entities: Readonly<Record<string, DefinitionStatus>>;
  /** Constraints that cannot be satisfied together, or refer to missing geometry. */
  conflicts: readonly string[];
  /** Status by entity and constraint id for the display: conflicting constraints are 'over'. */
  colors: Readonly<Record<string, DefinitionStatus>>;
}

/** Results per geometry object: unchanged sketches are never analyzed twice. */
const cache = new WeakMap<SketchData, SketchAnalysis>();
let running = false;
let queued = false;

/** Keeps `sketchAnalysis` (open sketch) and `sketchStatuses` (all sketches) up to date in the background. */
export function startSketchStatus(): void {
  store.subscribe((state, previous) => {
    if (state.sketch?.draft.sketch !== previous.sketch?.draft.sketch || state.history.features !== previous.history.features) schedule();
  });
  schedule();
}

function schedule(): void {
  queued = true;
  if (!running) void run();
}

function pending(): SketchData[] {
  const state = getState();
  const sketches: SketchData[] = [];
  const open = state.sketch?.draft.sketch;
  if (open && !cache.has(open)) sketches.push(open);
  for (const feature of state.history.features) if (feature.type === 'sketch' && !cache.has(feature.sketch)) sketches.push(feature.sketch);
  return sketches;
}

async function run(): Promise<void> {
  running = true;
  try {
    while (queued) {
      queued = false;
      // The open sketch first: its colors matter most.
      for (const sketch of pending()) {
        try {
          const solution = await sketchSolver().solve(sketch, { analyze: true });
          const entities = solution.status?.entities ?? {};
          const conflicts = [...solution.unsatisfied, ...solution.invalid];
          cache.set(sketch, {
            sketch,
            status: solution.status?.sketch ?? 'under',
            entities,
            conflicts,
            colors: { ...entities, ...Object.fromEntries(conflicts.map((id) => [id, 'over' as const])) },
          });
        } catch {
          // Solver restarted: try again with the next change.
        }
        publish();
        if (queued) break;
      }
      // Opening a sketch that is already analyzed only needs its cached result.
      publish();
    }
  } finally {
    running = false;
  }
}

function publish(): void {
  const state = getState();
  const open = state.sketch?.draft.sketch;
  const analysis = open ? (cache.get(open) ?? null) : null;
  const statuses: Record<string, DefinitionStatus> = {};
  for (const feature of state.history.features) {
    if (feature.type !== 'sketch' || feature.sketch.entities.length === 0) continue;
    const result = cache.get(feature.sketch);
    if (result) statuses[feature.id] = result.status;
  }
  const previous = state.sketchStatuses;
  const sameStatuses = Object.keys(statuses).length === Object.keys(previous).length && Object.entries(statuses).every(([id, status]) => previous[id] === status);
  if (analysis !== state.sketchAnalysis || !sameStatuses) setState({ sketchAnalysis: analysis, ...(sameStatuses ? {} : { sketchStatuses: statuses }) });
}

/** The analysis of the open sketch, if it belongs to the geometry shown now. */
export function currentAnalysis(): SketchAnalysis | null {
  const state = getState();
  const analysis = state.sketchAnalysis;
  return analysis && analysis.sketch === state.sketch?.draft.sketch ? analysis : null;
}
