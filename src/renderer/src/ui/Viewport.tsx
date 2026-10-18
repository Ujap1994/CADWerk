import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { isEdgeFeature } from '../../../shared/model/feature.ts';
import * as commands from '../commands.ts';
import { setState, store, type AppState, type Pick } from '../state/store.ts';
import { ViewportEngine } from '../viewport/engine.ts';
import { registerViewport } from '../viewport/registry.ts';
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

export function Viewport() {
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
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

    const sync = (state: AppState, previous: AppState | null) => {
      if (!previous || state.display !== previous.display) {
        engine.setBody(state.display.body, state.display.pickable);
        engine.setPreview(state.display.preview);
      }
      if (!previous || state.activeEdit !== previous.activeEdit || state.selection !== previous.selection || state.display !== previous.display) {
        engine.setSelection(visibleSelection(state));
        const edit = state.activeEdit;
        engine.setPickFilter(edit ? (isEdgeFeature(edit.draft) ? 'edges' : 'none') : 'all');
      }
      if (!previous || state.effectiveTheme !== previous.effectiveTheme) engine.setTheme(state.effectiveTheme);
      if (!previous || state.settings.projection !== previous.settings.projection) engine.setProjection(state.settings.projection);
      if (!previous || state.settings.navigation !== previous.settings.navigation) engine.setNavigation(state.settings.navigation);
      if (!previous || state.settings.showFrameStats !== previous.settings.showFrameStats) {
        engine.setFrameStatsEnabled(state.settings.showFrameStats);
      }
    };
    sync(store.getState(), null);
    const unsubscribe = store.subscribe((state, previous) => sync(state, previous));

    return () => {
      unsubscribe();
      registerViewport(null);
      engineRef.current = null;
      engine.dispose();
    };
  }, [i18n]);

  useEffect(() => {
    engineRef.current?.setCubeLabels(cubeLabels(t));
  }, [t, i18n.language]);

  return (
    <div className="viewport" data-testid="viewport">
      <div ref={containerRef} className="viewport-surface" />
      <ViewToolbar />
    </div>
  );
}
