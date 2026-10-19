import { useTranslation } from 'react-i18next';
import { STANDARD_PLANES, type SketchPlaneRef } from '../../../shared/model/sketch.ts';
import * as commands from '../commands.ts';
import { useAppState } from '../state/store.ts';
import { useFeatureName } from './FeatureTree.tsx';
import { CheckIcon, CloseIcon, PlaneIcon, SketchIcon } from './icons.tsx';

function usePlaneName() {
  const { t } = useTranslation();
  return (plane: SketchPlaneRef): string => (plane.kind === 'standard' ? t(`planes.${plane.plane}`) : t('status.face', { index: plane.face + 1 }));
}

function PlaneChoice() {
  const { t } = useTranslation();
  return (
    <section className="panel property-panel sketch-panel" aria-label={t('sketch.choosePlane')}>
      <div className="property-header">
        <SketchIcon className="property-icon" />
        <h2 className="panel-title">{t('sketch.choosePlane')}</h2>
        <div className="confirm-buttons">
          <button type="button" className="confirm-button is-cancel" title={`${t('panel.cancel')} (Esc)`} aria-label={t('panel.cancel')} data-testid="sketch-cancel" onClick={() => void commands.cancelSketch()}>
            <CloseIcon />
          </button>
        </div>
      </div>
      <fieldset className="panel-section">
        <legend className="panel-section-title">{t('sketch.plane')}</legend>
        <p className="panel-hint is-flush">{t('sketch.choosePlaneHint')}</p>
        <div className="plane-choices">
          {STANDARD_PLANES.map((plane, index) => (
            <button
              key={plane}
              type="button"
              className="plane-choice"
              data-plane={plane}
              onPointerEnter={() => commands.hoverPlane(index)}
              onPointerLeave={() => commands.hoverPlane(null)}
              onClick={() => commands.chooseSketchPlane({ kind: 'standard', plane })}
            >
              <PlaneIcon className="plane-choice-icon" />
              {t(`planes.${plane}`)}
            </button>
          ))}
        </div>
      </fieldset>
    </section>
  );
}

function OpenSketch() {
  const { t } = useTranslation();
  const session = useAppState((state) => state.sketch);
  const tool = useAppState((state) => state.sketchTool);
  const features = useAppState((state) => state.history.features);
  const nameOf = useFeatureName();
  const planeName = usePlaneName();
  if (!session) return null;

  const name = nameOf([...features.slice(0, session.index), session.draft], session.index);
  const title = session.mode === 'create' ? t('sketch.creating', { name }) : t('sketch.editing', { name });
  const { entities, constraints } = session.draft.sketch;

  return (
    <section className="panel property-panel sketch-panel" aria-label={title}>
      <div className="property-header">
        <SketchIcon className="property-icon" />
        <h2 className="panel-title" data-testid="sketch-title">
          {title}
        </h2>
        <div className="confirm-buttons">
          <button type="button" className="confirm-button is-ok" title={t('sketch.ok')} aria-label={t('sketch.ok')} data-testid="sketch-ok" onClick={commands.exitSketch}>
            <CheckIcon />
          </button>
          <button type="button" className="confirm-button is-cancel" title={t('sketch.cancel')} aria-label={t('sketch.cancel')} data-testid="sketch-cancel" onClick={() => void commands.cancelSketch()}>
            <CloseIcon />
          </button>
        </div>
      </div>
      <fieldset className="panel-section">
        <legend className="panel-section-title">{t('sketch.plane')}</legend>
        <div className="sketch-plane" data-testid="sketch-plane">
          <PlaneIcon className="plane-choice-icon" />
          {planeName(session.draft.plane)}
        </div>
      </fieldset>
      <fieldset className="panel-section" data-testid="sketch-tool">
        <legend className="panel-section-title">{t('sketch.tool')}</legend>
        <p className="sketch-tool-name">{tool ? t(`commands.sketchTools.${tool}`) : t('sketch.selectTool')}</p>
        <p className="panel-hint is-flush">{t(`sketch.toolHints.${tool ?? 'select'}`)}</p>
        {tool ? <p className="panel-hint is-flush">{t('sketch.toolHints.snapping')}</p> : null}
      </fieldset>
      <fieldset className="panel-section">
        <legend className="panel-section-title">{t('sketch.contents')}</legend>
        <p className="sketch-count">{t('sketch.entities', { count: entities.length })}</p>
        <p className="sketch-count">{t('sketch.constraints', { count: constraints.length })}</p>
        <p className="panel-hint is-flush">{t('sketch.exitHint')}</p>
      </fieldset>
    </section>
  );
}

/** Sidebar content in sketch mode, or while the sketch command waits for a plane. */
export function SketchPanel() {
  const choosing = useAppState((state) => state.choosingSketchPlane);
  return choosing ? <PlaneChoice /> : <OpenSketch />;
}
