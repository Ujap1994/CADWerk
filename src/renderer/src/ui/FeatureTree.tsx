import { useTranslation } from 'react-i18next';
import type { Feature } from '../../../shared/model/feature.ts';
import { STANDARD_PLANES } from '../../../shared/model/sketch.ts';
import * as commands from '../commands.ts';
import { featureOrdinal } from '../state/document.ts';
import { useAppState } from '../state/store.ts';
import { AlertIcon, EditIcon, EyeIcon, EyeOffIcon, FEATURE_ICONS, OriginIcon, PlaneIcon, SketchIcon, TrashIcon } from './icons.tsx';

export function useFeatureName() {
  const { t } = useTranslation();
  return (features: readonly Feature[], index: number): string => {
    const feature = features[index];
    if (!feature) return '';
    return feature.name ?? `${t(`features.${feature.type}`)}${featureOrdinal(features, index)}`;
  };
}

/** Front, Top and Right plane: select them, or sketch on them. */
function PlaneItems() {
  const { t } = useTranslation();
  const selection = useAppState((state) => state.selection);
  const hover = useAppState((state) => state.hover);
  const choosing = useAppState((state) => state.choosingSketchPlane);
  const sketching = useAppState((state) => state.sketch !== null);

  return STANDARD_PLANES.map((plane, index) => {
    const selected = selection.some((pick) => pick.kind === 'plane' && pick.index === index);
    const hovered = hover?.kind === 'plane' && hover.index === index;
    const classes = ['tree-item', 'is-reference', selected ? 'is-selected' : '', hovered ? 'is-hovered' : '', choosing ? 'is-choice' : ''].filter(Boolean).join(' ');
    return (
      <li
        key={plane}
        className={classes}
        role="treeitem"
        aria-selected={selected}
        data-plane={plane}
        onPointerEnter={() => commands.hoverPlane(index)}
        onPointerLeave={() => commands.hoverPlane(null)}
        onClick={(event) => {
          if (!sketching) commands.handlePick({ kind: 'plane', index }, event.ctrlKey || event.metaKey || event.shiftKey);
        }}
      >
        <PlaneIcon className="tree-icon" />
        <span className="tree-name">{t(`planes.${plane}`)}</span>
        {sketching || choosing ? null : (
          <span className="tree-actions">
            <button
              type="button"
              className="icon-button"
              title={t('tree.sketchOnPlane')}
              aria-label={t('tree.sketchOnPlane')}
              onClick={(event) => {
                event.stopPropagation();
                commands.chooseSketchPlane({ kind: 'standard', plane });
              }}
            >
              <SketchIcon />
            </button>
          </span>
        )}
      </li>
    );
  });
}

export function FeatureTree() {
  const { t } = useTranslation();
  const features = useAppState((state) => state.history.features);
  const results = useAppState((state) => state.rebuild?.results);
  const activeEdit = useAppState((state) => state.activeEdit ?? state.sketch);
  const locked = useAppState((state) => state.sketch !== null || state.choosingSketchPlane);
  const nameOf = useFeatureName();

  return (
    <section className={`panel feature-tree${locked ? ' is-locked' : ''}`} aria-label={t('tree.title')}>
      <h2 className="panel-title">{t('tree.title')}</h2>
      <ul className="tree-list" role="tree">
        <li className="tree-item is-static" role="treeitem" aria-selected={false}>
          <OriginIcon className="tree-icon" />
          <span className="tree-name">{t('features.origin')}</span>
        </li>
        <PlaneItems />
        {features.map((feature, index) => {
          const Icon = FEATURE_ICONS[feature.type];
          const result = !activeEdit ? results?.find((r) => r.id === feature.id) : undefined;
          const error = result?.status === 'error' ? result.error : undefined;
          const rolledBack = activeEdit !== null && (index > activeEdit.index || (activeEdit.mode === 'create' && index >= activeEdit.index));
          const editing = activeEdit?.mode === 'edit' && activeEdit.index === index;
          const classes = ['tree-item', feature.suppressed ? 'is-suppressed' : '', rolledBack ? 'is-rolled-back' : '', editing ? 'is-editing' : '', error ? 'has-error' : '']
            .filter(Boolean)
            .join(' ');
          return (
            <li
              key={feature.id}
              className={classes}
              role="treeitem"
              aria-selected={editing}
              data-feature-id={feature.id}
              title={rolledBack ? t('tree.rolledBack') : error ? t(`errors.${error.code}`, { detail: error.detail ?? '' }) : undefined}
              onDoubleClick={() => commands.editFeature(feature.id)}
            >
              <Icon className="tree-icon" />
              <span className="tree-name">{nameOf(features, index)}</span>
              {error ? <AlertIcon className="tree-status is-error" aria-label={t('tree.statusError')} /> : null}
              <span className="tree-actions" hidden={locked}>
                <button type="button" className="icon-button" title={t('tree.edit')} aria-label={t('tree.edit')} onClick={() => commands.editFeature(feature.id)}>
                  <EditIcon />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title={feature.suppressed ? t('tree.unsuppress') : t('tree.suppress')}
                  aria-label={feature.suppressed ? t('tree.unsuppress') : t('tree.suppress')}
                  onClick={() => commands.toggleSuppress(feature.id)}
                >
                  {feature.suppressed ? <EyeOffIcon /> : <EyeIcon />}
                </button>
                <button type="button" className="icon-button is-danger" title={t('tree.delete')} aria-label={t('tree.delete')} onClick={() => commands.deleteFeature(feature.id)}>
                  <TrashIcon />
                </button>
              </span>
            </li>
          );
        })}
        {activeEdit?.mode === 'create' ? (
          <li className="tree-item is-editing is-draft" role="treeitem" aria-selected>
            {(() => {
              const Icon = FEATURE_ICONS[activeEdit.draft.type];
              return <Icon className="tree-icon" />;
            })()}
            <span className="tree-name">{nameOf([...features, activeEdit.draft], features.length)}…</span>
          </li>
        ) : null}
      </ul>
      {features.length === 0 && !activeEdit ? <p className="panel-hint">{t('tree.empty')}</p> : null}
    </section>
  );
}
