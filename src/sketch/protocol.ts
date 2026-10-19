import type { SketchConstraint, SketchData } from '../shared/model/sketch.ts';
import type { DragTarget, SketchSolution } from './solver/index.ts';

/** Requests to the sketch solver worker. Every request is self-contained (the worker keeps no state). */
export type SolverRequest =
  | { type: 'solve'; sketch: SketchData; drag?: DragTarget; analyze: boolean }
  | { type: 'redundant'; sketch: SketchData; candidate: SketchConstraint };

export type SolverRequestMessage = SolverRequest & { id: number };

export type SolverResponseMessage =
  | { id: number; ok: true; result: SketchSolution | boolean }
  | { id: number; ok: false; error: string };
