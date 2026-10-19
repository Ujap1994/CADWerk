import { isDimension, type SketchData, type SketchDimension } from '../../../shared/model/sketch.ts';
import * as commands from '../commands.ts';
import { formatNumber, parseNumber } from '../format.ts';
import { t } from '../i18n.ts';
import { getState, setState, showToast, store, type AppState } from '../state/store.ts';
import type { SketchInput, SketchPointer, ViewportEngine } from '../viewport/engine.ts';
import type { SketchHighlight, SketchStatusColors } from '../viewport/sketch-graphics.ts';
import type { SketchToolDisplay } from '../viewport/sketch-layer.ts';
import type { SketchToolControl } from '../viewport/registry.ts';
import { displayValue, type DimensionDraft } from './dimensions.ts';
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
/** Two clicks on the same dimension within this time edit its value. */
const DOUBLE_CLICK_MS = 450;
/** Id of the dimension the dimension tool is placing (not part of the stored sketch). */
const DRAFT_ID = 'draft-dimension';

interface Gesture {
  start: SketchPointer;
  hit: SketchHit | null;
  /** The sketch when the button went down. */
  base: SketchData;
  session: DragSession | null;
  /** Drawing by dragging: the press placed the first point of a new shape. */
  drawing: boolean;
  /** A dimension label was grabbed: dragging moves the label. */
  dimension: SketchDimension | null;
  /** The sketch with the moved label, while dragging it. */
  moved: SketchData | null;
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

/**
 * Definition status colors of the open sketch. While the analysis of new geometry is still
 * running, the previous one is used: entity ids stay the same, so nothing flickers.
 */
export function statusColors(state: AppState): SketchStatusColors | null {
  return state.sketchAnalysis?.colors ?? null;
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
  return {
    geometry: preview.geometry,
    marker,
    guides: snap.alignments.map((alignment) => [alignment.from, [snap.u, snap.v]] as const),
    ...(preview.remove ? { remove: preview.remove } : {}),
  };
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
  /** Where the value editor of dimensions is placed (the viewport element). */
  private readonly editorHost: HTMLElement | null;
  private readonly unsubscribe: () => void;
  private editor: HTMLInputElement | null = null;
  private lastClick: { id: string; time: number } | null = null;
  /** The dimension tool's draft is drawn into the open sketch. */
  private draftShown = false;
  private gesture: Gesture | null = null;
  private tool: SketchTool | null = null;
  /** The sketch after the tool's last own change; any other change ends the tool's current shape. */
  private toolSketch: SketchData | null = null;
  private lastPointer: SketchPointer | null = null;

  constructor(
    engine: ViewportEngine,
    solver: () => SolverClient,
    showCursorInfo: (info: CursorInfo | null) => void = () => undefined,
    editorHost: HTMLElement | null = null,
  ) {
    this.engine = engine;
    this.solver = solver;
    this.showCursorInfo = showCursorInfo;
    this.editorHost = editorHost;
    this.unsubscribe = store.subscribe((state, previous) => {
      const optionsChanged =
        state.polygonSides !== previous.polygonSides || state.filletRadius !== previous.filletRadius || state.chamferDistance !== previous.chamferDistance;
      if (state.sketchTool !== previous.sketchTool || (state.sketch === null && previous.sketch !== null) || optionsChanged) {
        this.selectTool(state.sketchTool);
      }
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
    this.editor?.remove();
  }

  escape(): boolean {
    if (!this.tool) return false;
    if (this.tool.cancel()) this.refreshTool();
    else commands.setSketchTool(null);
    return true;
  }

  hover(pointer: SketchPointer | null): void {
    this.lastPointer = pointer;
    if (this.gesture || this.editor) return;
    if (this.tool) {
      this.toolHover(pointer);
      return;
    }
    const sketch = getState().sketch?.draft.sketch;
    const dimension = pointer ? this.engine.dimensionAt(pointer.x, pointer.y) : null;
    const hit = dimension ? null : pointer && sketch ? this.hitAt(sketch, pointer) : null;
    this.setHover(dimension ?? hit?.id ?? null);
    this.engine.setCursor(dimension ? 'move' : hit ? 'pointer' : '');
  }

  down(pointer: SketchPointer): void {
    const sketch = getState().sketch?.draft.sketch;
    if (!sketch || this.editor) return;
    const tool = this.tool;
    const labelId = tool ? null : this.engine.dimensionAt(pointer.x, pointer.y);
    const label = labelId ? sketch.constraints.find((constraint) => constraint.id === labelId) : undefined;
    const dimension = label && isDimension(label) ? label : null;
    this.gesture = {
      start: pointer,
      hit: tool || dimension ? null : this.hitAt(sketch, pointer),
      base: sketch,
      session: null,
      drawing: tool !== null && !tool.busy,
      dimension,
      moved: null,
    };
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
    if (gesture.dimension) {
      if (moved) this.moveLabel(gesture, gesture.dimension, pointer);
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
      if (solution && this.gesture === gesture) this.engine.setActiveSketch(solution.sketch, sketchHighlight(getState()), statusColors(getState()));
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
    if (gesture.dimension) {
      if (gesture.moved) commands.recordSketchChange(gesture.moved);
      else this.clickDimension(gesture.dimension, pointer);
      return;
    }
    if (gesture.session) void this.finishDrag(gesture, gesture.session);
    else commands.selectSketchEntity(gesture.hit?.id ?? null, pointer.additive);
  }

  /** Moves a dimension label with the mouse; stored on release (one undo step). */
  private moveLabel(gesture: Gesture, dimension: SketchDimension, pointer: SketchPointer): void {
    const [ox, oy] = dimension.offset ?? [0, 0];
    const offset: [number, number] = [ox + pointer.u - gesture.start.u, oy + pointer.v - gesture.start.v];
    const constraints = gesture.base.constraints.map((constraint) => (constraint.id === dimension.id ? { ...dimension, offset } : constraint));
    gesture.moved = { ...gesture.base, constraints };
    this.engine.setActiveSketch(gesture.moved, sketchHighlight(getState()), statusColors(getState()));
  }

  /** A click selects a dimension; a second click on it opens the value editor. */
  private clickDimension(dimension: SketchDimension, pointer: SketchPointer): void {
    const now = performance.now();
    const second = this.lastClick?.id === dimension.id && now - this.lastClick.time < DOUBLE_CLICK_MS;
    this.lastClick = second ? null : { id: dimension.id, time: now };
    if (!second) {
      commands.selectSketchEntity(dimension.id, pointer.additive);
      return;
    }
    const sketch = getState().sketch?.draft.sketch;
    if (!sketch) return;
    this.openEditor(dimension.id, displayValue(sketch, dimension), (typed) => {
      if (typed !== null) void commands.setSketchDimensionValue(dimension.id, typed);
    });
  }

  /**
   * The value editor over a dimension label. Enter or clicking elsewhere applies the value, Esc
   * closes without a value (`apply(null)`).
   */
  private openEditor(dimensionId: string, value: number | null, apply: (typed: number | null) => void): void {
    this.closeEditor();
    const host = this.editorHost;
    const label = this.engine.dimensionLabel(dimensionId);
    if (!host || !label) {
      apply(null);
      return;
    }
    const input = document.createElement('input');
    input.className = 'dimension-editor';
    input.dataset.testid = 'dimension-editor';
    input.inputMode = 'decimal';
    input.value = value === null ? '' : formatNumber(value, getState().language, 4);
    const hostRect = host.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    input.style.transform = `translate(${Math.round(labelRect.left - hostRect.left + labelRect.width / 2 - 46)}px, ${Math.round(labelRect.top - hostRect.top + labelRect.height / 2 - 12)}px)`;
    let done = false;
    const finish = (typed: number | null) => {
      if (done) return;
      done = true;
      this.closeEditor();
      apply(typed);
    };
    input.addEventListener('keydown', (event) => {
      // The editor owns these keys; the app's shortcuts must not see them.
      event.stopPropagation();
      if (event.key === 'Enter') finish(parseNumber(input.value));
      else if (event.key === 'Escape') finish(null);
    });
    input.addEventListener('blur', () => finish(parseNumber(input.value)));
    host.appendChild(input);
    this.editor = input;
    input.focus();
    input.select();
  }

  private closeEditor(): void {
    const editor = this.editor;
    this.editor = null;
    editor?.remove();
  }

  private selectTool(name: AppState['sketchTool']): void {
    this.tool?.cancel();
    const sketch = getState().sketch?.draft.sketch;
    if (sketch && !this.editor) this.showDraft(sketch, undefined);
    const { polygonSides, filletRadius, chamferDistance } = getState();
    this.tool = name ? createTool(name, { polygonSides, filletRadius, chamferDistance }) : null;
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
    // While a value is typed, the placed dimension stays as it is.
    if (this.editor) return;
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
    if (step.place) this.placeDimension(step.place);
    if (step.message) showToast('info', t(`sketch.messages.${step.message}`));
  }

  /** The dimension tool placed a dimension: ask for its value, then add it. */
  private placeDimension(draft: DimensionDraft): void {
    const sketch = getState().sketch?.draft.sketch;
    if (!sketch) return;
    this.showDraft(sketch, draft);
    this.showCursorInfo(null);
    this.engine.setSketchToolDisplay(null);
    // The label element is created and positioned by the next frame; render it now to place the editor on it.
    this.engine.renderFrame();
    this.openEditor(DRAFT_ID, displayValue(sketch, draft), (typed) => {
      this.draftShown = false;
      void commands.addSketchDimension(draft, typed);
    });
  }

  /** Draws the dimension the tool proposes (or would place) into the open sketch. */
  private showDraft(sketch: SketchData, draft: DimensionDraft | undefined): void {
    if (draft) {
      this.engine.setActiveSketch({ ...sketch, constraints: [...sketch.constraints, { ...draft, id: DRAFT_ID } as SketchDimension] }, sketchHighlight(getState()), statusColors(getState()));
      this.draftShown = true;
    } else if (this.draftShown) {
      this.engine.setActiveSketch(sketch, sketchHighlight(getState()), statusColors(getState()));
      this.draftShown = false;
    }
  }

  private showPreview(preview: ToolPreview, pointer: SketchPointer): void {
    const sketch = getState().sketch?.draft.sketch;
    if (sketch && this.tool?.name === 'dimension') {
      this.showDraft(sketch, preview.dimension);
      const picks = preview.picks ?? [];
      const selection = getState().sketchSelection;
      if (picks.length !== selection.length || picks.some((id, i) => id !== selection[i])) setState({ sketchSelection: [...picks] });
    }
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
    if (sameGeometry(result, gesture.base)) this.engine.setActiveSketch(gesture.base, sketchHighlight(state), statusColors(state));
    else commands.recordSketchChange(result);
  }

  private hitAt(sketch: SketchData, pointer: SketchPointer): SketchHit | null {
    return hitTest(sketch, pointPositions(sketch), pointer.u, pointer.v, PICK_TOLERANCE_PX * pointer.mmPerPixel);
  }
}
