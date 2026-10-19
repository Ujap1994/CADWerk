import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { STANDARD_PLANES, type SketchPlaneRef } from '../../../shared/model/sketch.ts';
import * as commands from '../commands.ts';
import { isDimension, type SketchConstraint } from '../../../shared/model/sketch.ts';
import { applicableRelations, relationKindOf, relationsOf } from '../sketch/relations.ts';
import { mirrorAxis } from '../sketch/transform.ts';
import type { SketchToolName } from '../sketch/tools.ts';
import { useAppState } from '../state/store.ts';
import { useFeatureName } from './FeatureTree.tsx';
import { CheckIcon, CloseIcon, PlaneIcon, SketchIcon, TrashIcon } from './icons.tsx';
import { NumberField } from './NumberField.tsx';

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

/** "Horizontal", "Distance 25", ... for lists of constraints. */
function useConstraintName() {
  const { t } = useTranslation();
  return (constraint: SketchConstraint): string => {
    if (isDimension(constraint)) return t(`sketch.dimensionNames.${constraint.type}`);
    const kind = relationKindOf(constraint);
    return kind ? t(`sketch.relationNames.${kind}`) : constraint.type;
  };
}

/** Tools that change existing geometry; the snapping hint is about drawing new geometry. */
const EDITING_TOOLS: ReadonlySet<SketchToolName> = new Set(['trim', 'extend', 'sketchFillet', 'sketchChamfer', 'dimension', 'convert']);

function CornerSize({ tool }: { tool: 'sketchFillet' | 'sketchChamfer' }) {
  const { t } = useTranslation();
  const size = useAppState((state) => (tool === 'sketchFillet' ? state.filletRadius : state.chamferDistance));
  return (
    <NumberField
      label={t(tool === 'sketchFillet' ? 'sketch.filletRadius' : 'sketch.chamferDistance')}
      value={size}
      step={0.5}
      testId="corner-size"
      onChange={(value) => commands.setCornerSize(tool, value)}
    />
  );
}

function PolygonSides() {
  const { t } = useTranslation();
  const sides = useAppState((state) => state.polygonSides);
  return (
    <NumberField label={t('sketch.polygonSides')} value={sides} unit="" step={1} testId="polygon-sides" onChange={(value) => commands.setPolygonSides(value)} />
  );
}

/** The transform section, for selections that contain geometry (not only dimensions). */
function SelectionTransforms() {
  const sketch = useAppState((state) => state.sketch?.draft.sketch);
  const selection = useAppState((state) => state.sketchSelection);
  if (!sketch) return null;
  const entities = new Set(sketch.entities.map((entity) => entity.id));
  return selection.some((id) => entities.has(id)) ? <TransformSection /> : null;
}

/** Under, fully or over defined, with what to do about it; conflicting constraints can be deleted. */
function DefinitionSection() {
  const { t } = useTranslation();
  const sketch = useAppState((state) => state.sketch?.draft.sketch);
  const analysis = useAppState((state) => state.sketchAnalysis);
  const nameOf = useConstraintName();
  if (!sketch || sketch.entities.length === 0 || !analysis) return null;
  const conflicts = analysis.conflicts.flatMap((id) => sketch.constraints.filter((constraint) => constraint.id === id));
  return (
    <fieldset className="panel-section">
      <legend className="panel-section-title">{t('sketch.definition')}</legend>
      <p className={`sketch-status is-${analysis.status}`} data-testid="sketch-status" data-status={analysis.status}>
        <span className="sketch-status-dot" aria-hidden="true" />
        {t(`sketch.status.${analysis.status}`)}
      </p>
      <p className="panel-hint is-flush">{t(`sketch.statusHint.${analysis.status}`)}</p>
      {conflicts.length > 0 ? (
        <>
          <span className="field-label">{t('sketch.conflicts')}</span>
          <ul className="relation-list" data-testid="sketch-conflicts">
            {conflicts.map((constraint) => (
              <li key={constraint.id} className="relation-item" data-constraint={constraint.id}>
                <span>{nameOf(constraint)}</span>
                <button
                  type="button"
                  className="icon-button is-danger"
                  title={t('sketch.deleteConflict')}
                  aria-label={t('sketch.deleteConflict')}
                  onClick={() => commands.deleteSketchConstraint(constraint.id)}
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </fieldset>
  );
}

type TransformKind = 'offset' | 'mirror' | 'linear' | 'circular' | 'move' | 'scale';

/** Mirror, patterns, move and copy for the selected geometry, with their numbers. */
function TransformSection() {
  const { t } = useTranslation();
  const sketch = useAppState((state) => state.sketch?.draft.sketch);
  const selection = useAppState((state) => state.sketchSelection);
  const [kind, setKind] = useState<TransformKind>('offset');
  const [offset, setOffset] = useState(2);
  const [flip, setFlip] = useState(false);
  const [count, setCount] = useState(3);
  const [step, setStep] = useState<[number, number]>([10, 0]);
  const [circularCount, setCircularCount] = useState(6);
  const [totalAngle, setTotalAngle] = useState(360);
  const [shift, setShift] = useState<[number, number]>([10, 0]);
  const [rotation, setRotation] = useState(0);
  const [factor, setFactor] = useState(2);
  if (!sketch) return null;
  const aroundPoint = commands.selectionPivot().point !== null;
  const kinds: TransformKind[] = ['offset', 'mirror', 'linear', 'circular', 'move', 'scale'];
  return (
    <fieldset className="panel-section" data-testid="sketch-transform">
      <legend className="panel-section-title">{t('sketch.transform.title')}</legend>
      <div className="segmented transform-kinds" role="radiogroup" aria-label={t('sketch.transform.title')}>
        {kinds.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={kind === option}
            data-transform={option}
            className={`segmented-option${kind === option ? ' is-selected' : ''}`}
            onClick={() => setKind(option)}
          >
            {t(`sketch.transform.${option}`)}
          </button>
        ))}
      </div>
      {kind === 'offset' ? (
        <>
          <NumberField label={t('sketch.transform.distance')} value={offset} step={0.5} testId="offset-distance" onChange={setOffset} />
          <label className="checkbox-field">
            <input type="checkbox" checked={flip} data-testid="offset-flip" onChange={(event) => setFlip(event.target.checked)} />
            {t('sketch.transform.flip')}
          </label>
          <p className="panel-hint is-flush">{t('sketch.transform.offsetHint')}</p>
          <button type="button" className="text-button transform-action" onClick={() => commands.offsetSketchSelection(offset, flip)}>
            {t('sketch.transform.offsetAction')}
          </button>
        </>
      ) : null}
      {kind === 'mirror' ? (
        <>
          <p className="panel-hint is-flush">{t('sketch.transform.mirrorHint')}</p>
          <button type="button" className="text-button transform-action" disabled={!mirrorAxis(sketch, selection)} onClick={commands.mirrorSketchSelection}>
            {t('sketch.transform.mirrorAction')}
          </button>
        </>
      ) : null}
      {kind === 'linear' ? (
        <>
          <NumberField label={t('sketch.transform.count')} value={count} unit="" testId="pattern-count" onChange={(value) => setCount(Math.max(2, Math.round(value)))} />
          <div className="field-row is-two">
            <NumberField label={t('sketch.transform.stepX')} value={step[0]} signed testId="pattern-step-x" onChange={(value) => setStep([value, step[1]])} />
            <NumberField label={t('sketch.transform.stepY')} value={step[1]} signed testId="pattern-step-y" onChange={(value) => setStep([step[0], value])} />
          </div>
          <button type="button" className="text-button transform-action" onClick={() => commands.patternSketchSelection({ kind: 'linear', step, count })}>
            {t('sketch.transform.patternAction')}
          </button>
        </>
      ) : null}
      {kind === 'circular' ? (
        <>
          <NumberField label={t('sketch.transform.count')} value={circularCount} unit="" testId="pattern-circular-count" onChange={(value) => setCircularCount(Math.max(2, Math.round(value)))} />
          <NumberField label={t('sketch.transform.totalAngle')} value={totalAngle} unit="°" testId="pattern-angle" onChange={(value) => setTotalAngle(Math.min(360, value))} />
          <p className="panel-hint is-flush">{t(aroundPoint ? 'sketch.transform.aroundPoint' : 'sketch.transform.aroundOrigin')}</p>
          <button type="button" className="text-button transform-action" onClick={() => commands.patternSketchSelection({ kind: 'circular', count: circularCount, angle: totalAngle })}>
            {t('sketch.transform.patternAction')}
          </button>
        </>
      ) : null}
      {kind === 'move' ? (
        <>
          <div className="field-row is-two">
            <NumberField label={t('sketch.transform.dx')} value={shift[0]} signed testId="move-dx" onChange={(value) => setShift([value, shift[1]])} />
            <NumberField label={t('sketch.transform.dy')} value={shift[1]} signed testId="move-dy" onChange={(value) => setShift([shift[0], value])} />
          </div>
          <NumberField label={t('sketch.transform.rotation')} value={rotation} unit="°" signed testId="move-rotation" onChange={setRotation} />
          <p className="panel-hint is-flush">{t(aroundPoint ? 'sketch.transform.aroundPoint' : 'sketch.transform.aroundOrigin')}</p>
          <div className="transform-buttons">
            <button type="button" className="text-button transform-action" onClick={() => void commands.moveSketchSelection(shift, rotation)}>
              {t('sketch.transform.moveAction')}
            </button>
            <button type="button" className="text-button transform-action" onClick={() => commands.copySketchSelection(shift, rotation)}>
              {t('sketch.transform.copyAction')}
            </button>
          </div>
        </>
      ) : null}
      {kind === 'scale' ? (
        <>
          <NumberField label={t('sketch.transform.factor')} value={factor} unit="×" step={0.1} testId="scale-factor" onChange={(value) => setFactor(Math.max(1e-3, value))} />
          <p className="panel-hint is-flush">{t(aroundPoint ? 'sketch.transform.aroundPoint' : 'sketch.transform.aroundOrigin')}</p>
          <p className="panel-hint is-flush">{t('sketch.transform.scaleHint')}</p>
          <div className="transform-buttons">
            <button type="button" className="text-button transform-action" data-testid="scale-apply" onClick={() => void commands.scaleSketchSelection(factor, false)}>
              {t('sketch.transform.scaleAction')}
            </button>
            <button type="button" className="text-button transform-action" data-testid="scale-copy" onClick={() => void commands.scaleSketchSelection(factor, true)}>
              {t('sketch.transform.scaledCopyAction')}
            </button>
          </div>
        </>
      ) : null}
    </fieldset>
  );
}

/** Relations to add to the selected geometry, and the relations it already has. */
function SelectionSection() {
  const { t } = useTranslation();
  const sketch = useAppState((state) => state.sketch?.draft.sketch);
  const selection = useAppState((state) => state.sketchSelection);
  if (!sketch || selection.length === 0) return null;
  const dimensions = new Set(sketch.constraints.filter(isDimension).map((dimension) => dimension.id));
  if (selection.every((id) => dimensions.has(id))) {
    return (
      <fieldset className="panel-section" data-testid="sketch-selection">
        <legend className="panel-section-title">{t('sketch.selection')}</legend>
        <p className="sketch-count">{t('sketch.dimensionsSelected', { count: selection.length })}</p>
        <p className="panel-hint is-flush">{t('sketch.dimensionHint')}</p>
      </fieldset>
    );
  }
  const selectedRelations = sketch.constraints.filter((constraint) => selection.includes(constraint.id) && !isDimension(constraint));
  if (selectedRelations.length === selection.length) {
    return (
      <fieldset className="panel-section" data-testid="sketch-selection">
        <legend className="panel-section-title">{t('sketch.selection')}</legend>
        <p className="sketch-count">{t('sketch.relationsSelected', { count: selection.length })}</p>
        <RelationList constraints={selectedRelations} />
        <p className="panel-hint is-flush">{t('sketch.relationHint')}</p>
      </fieldset>
    );
  }
  const options = applicableRelations(sketch, selection);
  const existing = relationsOf(sketch, selection);
  return (
    <fieldset className="panel-section" data-testid="sketch-selection">
      <legend className="panel-section-title">{t('sketch.selection')}</legend>
      <p className="sketch-count">{t('status.selected', { count: selection.length })}</p>
      <span className="field-label">{t('sketch.addRelation')}</span>
      {options.length > 0 ? (
        <div className="relation-buttons">
          {options.map((option) => (
            <button key={option.kind} type="button" className="relation-button" data-relation={option.kind} onClick={() => void commands.addSketchRelation(option.kind)}>
              {t(`sketch.relationNames.${option.kind}`)}
            </button>
          ))}
        </div>
      ) : (
        <p className="panel-hint is-flush">{t('sketch.noApplicableRelation')}</p>
      )}
      <span className="field-label">{t('sketch.existingRelations')}</span>
      {existing.length > 0 ? <RelationList constraints={existing} /> : <p className="panel-hint is-flush">{t('sketch.noRelations')}</p>}
    </fieldset>
  );
}

/** Relations by name, each with a delete button; hovering an entry highlights its geometry. */
function RelationList({ constraints }: { constraints: readonly SketchConstraint[] }) {
  const { t } = useTranslation();
  return (
    <ul className="relation-list">
      {constraints.map((constraint) => {
        const kind = relationKindOf(constraint);
        return (
          <li
            key={constraint.id}
            className="relation-item"
            data-constraint={constraint.id}
            onPointerEnter={() => commands.hoverSketchEntity(constraint.id)}
            onPointerLeave={() => commands.hoverSketchEntity(null)}
          >
            <span>{kind ? t(`sketch.relationNames.${kind}`) : constraint.type}</span>
            <button
              type="button"
              className="icon-button is-danger"
              title={t('sketch.deleteRelation')}
              aria-label={t('sketch.deleteRelation')}
              onClick={() => commands.deleteSketchConstraint(constraint.id)}
            >
              <TrashIcon />
            </button>
          </li>
        );
      })}
    </ul>
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
      <DefinitionSection />
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
        {tool === 'polygon' ? <PolygonSides /> : null}
        {tool === 'sketchFillet' || tool === 'sketchChamfer' ? <CornerSize tool={tool} /> : null}
        {tool && !EDITING_TOOLS.has(tool) ? <p className="panel-hint is-flush">{t('sketch.toolHints.snapping')}</p> : null}
      </fieldset>
      {tool ? null : <SelectionSection />}
      {tool ? null : <SelectionTransforms />}
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
