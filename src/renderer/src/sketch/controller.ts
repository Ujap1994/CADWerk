import type { SketchData } from '../../../shared/model/sketch.ts';
import * as commands from '../commands.ts';
import { getState, setState, type AppState } from '../state/store.ts';
import type { SketchInput, SketchPointer, ViewportEngine } from '../viewport/engine.ts';
import type { SketchHighlight } from '../viewport/sketch-graphics.ts';
import { dragTarget, sameGeometry } from './drag.ts';
import { hitTest, pointPositions, type SketchHit } from './geometry.ts';
import type { DragSession, SolverClient } from './solver-client.ts';

/** How close (in pixels) the cursor must be to grab geometry. */
const PICK_TOLERANCE_PX = 6;
/** Movement (in pixels) that turns a click into a drag. */
const DRAG_THRESHOLD_PX = 4;

interface Gesture {
  start: SketchPointer;
  hit: SketchHit | null;
  /** The sketch when the button went down. */
  base: SketchData;
  session: DragSession | null;
}

export function sketchHighlight(state: AppState): SketchHighlight {
  return { hovered: state.sketchHover, selected: state.sketchSelection };
}

/**
 * Mouse interaction in sketch mode: hover, click selection and dragging with live solving.
 * While dragging, it drives the engine's sketch layer directly with the solver's intermediate
 * results and stores only the final geometry, as one undo step, when the button is released.
 */
export class SketchController implements SketchInput {
  private readonly engine: ViewportEngine;
  private readonly solver: () => SolverClient;
  private gesture: Gesture | null = null;

  constructor(engine: ViewportEngine, solver: () => SolverClient) {
    this.engine = engine;
    this.solver = solver;
  }

  hover(pointer: SketchPointer | null): void {
    if (this.gesture) return;
    const sketch = getState().sketch?.draft.sketch;
    const hit = pointer && sketch ? this.hitAt(sketch, pointer) : null;
    const id = hit?.id ?? null;
    if (getState().sketchHover !== id) setState({ sketchHover: id });
    this.engine.setCursor(hit ? 'pointer' : '');
  }

  down(pointer: SketchPointer): void {
    const sketch = getState().sketch?.draft.sketch;
    if (!sketch) return;
    this.gesture = { start: pointer, hit: this.hitAt(sketch, pointer), base: sketch, session: null };
  }

  move(pointer: SketchPointer): void {
    const gesture = this.gesture;
    if (!gesture?.hit) return;
    if (!gesture.session) {
      if (Math.hypot(pointer.x - gesture.start.x, pointer.y - gesture.start.y) < DRAG_THRESHOLD_PX) return;
      gesture.session = this.solver().startDrag(gesture.base);
    }
    const target = dragTarget(gesture.base, gesture.hit, gesture.start, pointer);
    if (!target) return;
    void gesture.session.move(target).then((solution) => {
      if (solution && this.gesture === gesture) this.engine.setActiveSketch(solution.sketch, sketchHighlight(getState()));
    });
  }

  up(pointer: SketchPointer): void {
    const gesture = this.gesture;
    this.gesture = null;
    if (!gesture) return;
    if (gesture.session) void this.finishDrag(gesture, gesture.session);
    else commands.selectSketchEntity(gesture.hit?.id ?? null, pointer.additive);
  }

  /** Waits for the solver and stores the result; geometry that cannot move springs back. */
  private async finishDrag(gesture: Gesture, session: DragSession): Promise<void> {
    let result: SketchData = gesture.base;
    try {
      const solution = await session.end();
      if (solution.converged) result = solution.sketch;
    } catch {
      // The solver crashed or was restarted: keep the geometry as it was.
    }
    const state = getState();
    // The sketch changed meanwhile (undo, exit): this drag no longer applies.
    if (state.sketch?.draft.sketch !== gesture.base) return;
    if (sameGeometry(result, gesture.base)) this.engine.setActiveSketch(gesture.base, sketchHighlight(state));
    else commands.recordSketchChange(result);
  }

  private hitAt(sketch: SketchData, pointer: SketchPointer): SketchHit | null {
    return hitTest(sketch, pointPositions(sketch), pointer.u, pointer.v, PICK_TOLERANCE_PX * pointer.mmPerPixel);
  }
}
