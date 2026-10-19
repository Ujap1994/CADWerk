import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { isEdgeFeature } from '../../../shared/model/feature.ts';
import { frameOf, STANDARD_PLANES } from '../../../shared/model/sketch.ts';
import * as commands from '../commands.ts';
import { SketchController, sketchHighlight, statusColors } from '../sketch/controller.ts';
import { sketchSolver } from '../sketch/solver.ts';
import { setState, store, type AppState, type Pick } from '../state/store.ts';
import { ViewportEngine, type InactiveSketch, type PickFilter } from '../viewport/engine.ts';
import type { PlaneDisplay } from '../viewport/reference-planes.ts';
import { registerSketchControl, registerViewport } from '../viewport/registry.ts';
import type { CubeFace } from '../viewport/view-cube.ts';
import { ViewToolbar } from './ViewToolbar.tsx';

function cubeLabels(t: (key: string) => string): Record<CubeFace, string> {
  return {
    front: t('viewcube.front'),
    back: t('viewcube.back'),
    left: t('viewcube.left'),
    right: t('viewcube.right'),
    top: t('viewcube.top'),
    bottom: t('viewcube.bottom'),
  };
}

/** Selection shown in the view: the draft's edges while editing a fillet/chamfer, otherwise the user selection. */
function visibleSelection(state: AppState): Pick[] {
  const edit = state.activeEdit;
  if (edit && isEdgeFeature(edit.draft)) return edit.draft.edges.map((ref) => ({ kind: 'edge', index: ref.index }));
  return state.selection;
}

function pickFilter(state: AppState): PickFilter {
  if (state.choosingSketchPlane) return 'planes';
  if (state.sketch) return 'none';
  const edit = state.activeEdit;
  return edit ? (isEdgeFeature(edit.draft) ? 'edges' : 'none') : 'all';
}

/** Sketches shown in the 3D view besides the open one: those before the current edit position, unless suppressed. */
function inactiveSketches(state: AppState): InactiveSketch[] {
  const features = state.history.features;
  const end = state.sketch?.index ?? state.activeEdit?.index ?? features.length;
  const sketches: InactiveSketch[] = [];
  for (const feature of features.slice(0, end)) {
    if (feature.type === 'sketch' && !feature.suppressed) sketches.push({ id: feature.id, frame: frameOf(feature.plane), data: feature.sketch });
  }
  return sketches;
}

/** All planes while choosing a sketch plane; otherwise only hovered (also in the tree) and selected ones. */
function planeDisplay(state: AppState): PlaneDisplay {
  if (state.sketch) return { visible: [], hovered: null, selected: [] };
  return {
    visible: STANDARD_PLANES.map(() => state.choosingSketchPlane),
    hovered: state.hover?.kind === 'plane' ? state.hover.index : null,
    selected: state.selection.filter((pick) => pick.kind === 'plane').map((pick) => pick.index),
  };
}

export function Viewport() {
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const cursorInfoRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ViewportEngine | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const engine = new ViewportEngine(
      container,
      {
        onHover: (hover) => setState({ hover }),
        onPick: (pick, additive) => commands.handlePick(pick, additive),
        onFrameStats: (frameStats) => setState({ frameStats }),
      },
      cubeLabels(i18n.t.bind(i18n)),
    );
    engineRef.current = engine;
    registerViewport(engine);
    // The measurement next to the cursor follows every mouse move, so it bypasses React.
    const controller = new SketchController(engine, sketchSolver, (info) => {
      const element = cursorInfoRef.current;
      if (!element) return;
      element.hidden = info === null;
      if (!info) return;
      element.textContent = info.text;
      element.style.transform = `translate(${Math.round(info.x + 18)}px, ${Math.round(info.y + 20)}px)`;
    }, viewportRef.current);
    engine.setSketchInput(controller);
    registerSketchControl(controller);

    const sync = (state: AppState, previous: AppState | null) => {
      if (!previous || state.display !== previous.display) {
        engine.setBody(state.display.body, state.display.pickable);
        engine.setPreview(state.display.preview);
      }
      if (
        !previous ||
        state.activeEdit !== previous.activeEdit ||
        state.selection !== previous.selection ||
        state.display !== previous.display ||
        state.choosingSketchPlane !== previous.choosingSketchPlane ||
        state.sketch !== previous.sketch
      ) {
        engine.setSelection(visibleSelection(state));
        engine.setPickFilter(pickFilter(state));
      }
      if (
        !previous ||
        state.choosingSketchPlane !== previous.choosingSketchPlane ||
        state.selection !== previous.selection ||
        state.hover !== previous.hover ||
        (state.sketch === null) !== (previous.sketch === null)
      ) {
        engine.setReferencePlanes(planeDisplay(state));
      }
      const plane = state.sketch?.draft.plane;
      if (!previous || plane !== previous.sketch?.draft.plane) {
        // Entering sketch mode turns the view normal to the sketch plane.
        engine.setSketchFrame(plane ? frameOf(plane) : null, plane !== undefined && !previous?.sketch);
      }
      const sketch = state.sketch?.draft.sketch;
      if (sketch && (sketch !== previous?.sketch?.draft.sketch || plane !== previous.sketch.draft.plane || state.sketchAnalysis !== previous.sketchAnalysis)) {
        engine.setActiveSketch(sketch, sketchHighlight(state), statusColors(state));
      } else if (sketch && (state.sketchHover !== previous?.sketchHover || state.sketchSelection !== previous.sketchSelection)) {
        engine.setSketchHighlight(sketchHighlight(state));
      }
      if (
        !previous ||
        state.history.features !== previous.history.features ||
        state.sketch?.index !== previous.sketch?.index ||
        state.activeEdit?.index !== previous.activeEdit?.index
      ) {
        engine.setInactiveSketches(inactiveSketches(state));
      }
      if (!previous || state.effectiveTheme !== previous.effectiveTheme) engine.setTheme(state.effectiveTheme);
      if (!previous || state.language !== previous.language) engine.setDimensionLanguage(state.language);
      if (!previous || state.settings.projection !== previous.settings.projection) engine.setProjection(state.settings.projection);
      if (!previous || state.settings.navigation !== previous.settings.navigation) engine.setNavigation(state.settings.navigation);
      if (!previous || state.settings.showSketchRelations !== previous.settings.showSketchRelations) {
        engine.setShowRelations(state.settings.showSketchRelations);
      }
      if (!previous || state.settings.showFrameStats !== previous.settings.showFrameStats) {
        engine.setFrameStatsEnabled(state.settings.showFrameStats);
      }
    };
    sync(store.getState(), null);
    const unsubscribe = store.subscribe((state, previous) => sync(state, previous));

    return () => {
      unsubscribe();
      controller.dispose();
      registerSketchControl(null);
      registerViewport(null);
      engineRef.current = null;
      engine.dispose();
    };
  }, [i18n]);

  useEffect(() => {
    engineRef.current?.setCubeLabels(cubeLabels(t));
  }, [t, i18n.language]);

  return (
    <div ref={viewportRef} className="viewport" data-testid="viewport">
      <div ref={containerRef} className="viewport-surface" />
      <div ref={cursorInfoRef} className="sketch-cursor-info" data-testid="sketch-cursor-info" hidden />
      <ViewToolbar />
    </div>
  );
}
