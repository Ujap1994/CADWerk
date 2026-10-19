import type { SketchData } from '../../../shared/model/sketch.ts';
import * as commands from '../commands.ts';
import { formatNumber } from '../format.ts';
import { t } from '../i18n.ts';
import { getState, setState, store, type AppState } from '../state/store.ts';
import type { SketchInput, SketchPointer, ViewportEngine } from '../viewport/engine.ts';
import type { SketchHighlight } from '../viewport/sketch-graphics.ts';
import type { SketchToolDisplay } from '../viewport/sketch-layer.ts';
import type { SketchToolControl } from '../viewport/registry.ts';
import { dragTarget, sameGeometry } from './drag.ts';
import { hitTest, pointPositions, type SketchHit } from './geometry.ts';
import type { DragSession, SolverClient } from './solver-client.ts';
import { createTool, type SketchTool, type ToolEvent, type ToolInfo, type ToolPreview } from './tools.ts';

/** How close (in pixels) the cursor must be to grab geometry. */
const PICK_TOLERANCE_PX = 6;
/** Snap distance of the drawing tools, in pixels. */
const SNAP_PX = 8;
/** Distance within which the cursor aligns with other points, in pixels. */
const ALIGN_PX = 5;
/** Movement (in pixels) that turns a click into a drag. */
const DRAG_THRESHOLD_PX = 4;

interface Gesture {
  start: SketchPointer;
  hit: SketchHit | null;
  /** The sketch when the button went down. */
  base: SketchData;
  session: DragSession | null;
  /** Drawing by dragging: the press placed the first point of a new shape. */
  drawing: boolean;
}

/** Text and position of the measurement shown next to the cursor while drawing. */
export interface CursorInfo {
  text: string;
  x: number;
  y: number;
}

export function sketchHighlight(state: AppState): SketchHighlight {
  return { hovered: state.sketchHover, selected: state.sketchSelection };
}

function toolEvent(pointer: SketchPointer): ToolEvent {
  return { u: pointer.u, v: pointer.v, tolerance: SNAP_PX * pointer.mmPerPixel, alignTolerance: ALIGN_PX * pointer.mmPerPixel };
}

/** "48.3 mm · 30° · Horizontal" in the current language. */
export function describeToolInfo(info: ToolInfo, language: string): string {
  const number = (value: number) => formatNumber(value, language === 'de' ? 'de' : 'en', 2);
  const parts: string[] = [];
  if (info.length !== undefined) parts.push(`${number(info.length)} mm`);
  if (info.width !== undefined && info.height !== undefined) parts.push(`${number(info.width)} × ${number(info.height)} mm`);
  if (info.radius !== undefined) parts.push(`R ${number(info.radius)} mm`);
  if (info.angle !== undefined) parts.push(`${number(info.angle)}°`);
  for (const relation of info.relations) parts.push(t(`sketch.relationNames.${relation}`));
  return parts.join(' · ');
}

function toolDisplay(preview: ToolPreview): SketchToolDisplay {
  const { snap } = preview;
  const marker = snap.target.kind === 'none' ? null : { u: snap.u, v: snap.v, ring: snap.target.kind !== 'point' };
  return { geometry: preview.geometry, marker, guides: snap.alignments.map((alignment) => [alignment.from, [snap.u, snap.v]] as const) };
}

/**
 * Mouse interaction in sketch mode: drawing tools, hover, click selection and dragging with
 * live solving. While dragging or drawing, it drives the engine's sketch layer directly and
 * stores only finished operations, each as one undo step.
 */
export class SketchController implements SketchInput, SketchToolControl {
  private readonly engine: ViewportEngine;
  private readonly solver: () => SolverClient;
  private readonly showCursorInfo: (info: CursorInfo | null) => void;
  private readonly unsubscribe: () => void;
  private gesture: Gesture | null = null;
  private tool: SketchTool | null = null;
  /** The sketch after the tool's last own change; any other change ends the tool's current shape. */
  private toolSketch: SketchData | null = null;
  private lastPointer: SketchPointer | null = null;

  constructor(engine: ViewportEngine, solver: () => SolverClient, showCursorInfo: (info: CursorInfo | null) => void = () => undefined) {
    this.engine = engine;
    this.solver = solver;
    this.showCursorInfo = showCursorInfo;
    this.unsubscribe = store.subscribe((state, previous) => {
      if (state.sketchTool !== previous.sketchTool || (state.sketch === null && previous.sketch !== null)) this.selectTool(state.sketchTool);
      else if (this.tool && state.sketch && state.sketch.draft.sketch !== this.toolSketch) {
        // Undo, redo or another change: the shape in progress may refer to geometry that is gone.
        this.tool.cancel();
        this.toolSketch = state.sketch.draft.sketch;
        this.refreshTool();
      }
    });
  }

  dispose(): void {
    this.unsubscribe();
  }

  escape(): boolean {
    if (!this.tool) return false;
    if (this.tool.cancel()) this.refreshTool();
    else commands.setSketchTool(null);
    return true;
  }

  hover(pointer: SketchPointer | null): void {
    this.lastPointer = pointer;
    if (this.gesture) return;
    if (this.tool) {
      this.toolHover(pointer);
      return;
    }
    const sketch = getState().sketch?.draft.sketch;
    const hit = pointer && sketch ? this.hitAt(sketch, pointer) : null;
    this.setHover(hit?.id ?? null);
    this.engine.setCursor(hit ? 'pointer' : '');
  }

  down(pointer: SketchPointer): void {
    const sketch = getState().sketch?.draft.sketch;
    if (!sketch) return;
    const tool = this.tool;
    this.gesture = { start: pointer, hit: tool ? null : this.hitAt(sketch, pointer), base: sketch, session: null, drawing: tool !== null && !tool.busy };
  }

  move(pointer: SketchPointer): void {
    this.lastPointer = pointer;
    const gesture = this.gesture;
    if (!gesture) return;
    const moved = Math.hypot(pointer.x - gesture.start.x, pointer.y - gesture.start.y) >= DRAG_THRESHOLD_PX;
    if (this.tool) {
      // Press, drag and release draws a shape in one go: the press is its first point.
      if (moved && gesture.drawing && !this.tool.busy) this.toolClick(gesture.start);
      this.toolHover(pointer);
      return;
    }
    if (!gesture.hit) return;
    if (!gesture.session) {
      if (!moved) return;
      gesture.session = this.solver().startDrag(gesture.base);
    }
    const target = dragTarget(gesture.base, gesture.hit, gesture.start, pointer);
    if (!target) return;
    void gesture.session.move(target).then((solution) => {
      if (solution && this.gesture === gesture) this.engine.setActiveSketch(solution.sketch, sketchHighlight(getState()));
    });
  }

  up(pointer: SketchPointer, moved: boolean): void {
    const gesture = this.gesture;
    this.gesture = null;
    if (!gesture) return;
    if (this.tool) {
      const dragged = moved && gesture.drawing && this.tool.busy;
      this.toolClick(pointer);
      // A line drawn by dragging is a single line, not the start of a chain.
      if (dragged && this.tool.busy && (this.tool.name === 'line' || this.tool.name === 'centerline')) this.tool.cancel();
      this.toolHover(pointer);
      return;
    }
    if (gesture.session) void this.finishDrag(gesture, gesture.session);
    else commands.selectSketchEntity(gesture.hit?.id ?? null, pointer.additive);
  }

  private selectTool(name: AppState['sketchTool']): void {
    this.tool?.cancel();
    this.tool = name ? createTool(name) : null;
    this.toolSketch = getState().sketch?.draft.sketch ?? null;
    if (!this.tool) {
      this.engine.setSketchToolDisplay(null);
      this.showCursorInfo(null);
      this.engine.setCursor('');
      return;
    }
    this.refreshTool();
  }

  private refreshTool(): void {
    this.toolHover(this.lastPointer);
  }

  private toolHover(pointer: SketchPointer | null): void {
    const sketch = getState().sketch?.draft.sketch;
    if (!this.tool || !sketch || !pointer) {
      this.engine.setSketchToolDisplay(null);
      this.showCursorInfo(null);
      return;
    }
    this.showPreview(this.tool.hover(sketch, toolEvent(pointer)), pointer);
  }

  private toolClick(pointer: SketchPointer): void {
    const sketch = getState().sketch?.draft.sketch;
    if (!this.tool || !sketch) return;
    const step = this.tool.click(sketch, toolEvent(pointer));
    if (step.commit && step.commit !== sketch) {
      this.toolSketch = step.commit;
      commands.recordSketchChange(step.commit);
    }
    this.showPreview(step.preview, pointer);
  }

  private showPreview(preview: ToolPreview, pointer: SketchPointer): void {
    this.engine.setSketchToolDisplay(toolDisplay(preview));
    this.engine.setCursor('crosshair');
    const target = preview.snap.target;
    this.setHover(target.kind === 'point' ? target.id : target.kind === 'curve' ? target.curve : target.kind === 'midpoint' ? target.line : null);
    const text = preview.info ? describeToolInfo(preview.info, getState().language) : '';
    this.showCursorInfo(text ? { text, x: pointer.x, y: pointer.y } : null);
  }

  private setHover(id: string | null): void {
    if (getState().sketchHover !== id) setState({ sketchHover: id });
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
