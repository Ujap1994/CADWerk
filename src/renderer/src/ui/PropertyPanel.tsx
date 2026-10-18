import { useTranslation } from 'react-i18next';
import type { Axis, BooleanOperation, Feature, Vec3 } from '../../../shared/model/feature.ts';
import * as commands from '../commands.ts';
import { hasBodyBefore } from '../state/document.ts';
import { useAppState } from '../state/store.ts';
import { CheckIcon, CloseIcon, FEATURE_ICONS } from './icons.tsx';
import { NumberField } from './NumberField.tsx';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="panel-section">
      <legend className="panel-section-title">{title}</legend>
      {children}
    </fieldset>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange(value: T): void;
  disabled?: boolean;
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={`segmented-option${value === option.value ? ' is-selected' : ''}`}
            disabled={disabled && value !== option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PositionFields({ value, onChange }: { value: Vec3; onChange(value: Vec3): void }) {
  return (
    <div className="field-row">
      {(['X', 'Y', 'Z'] as const).map((axis, i) => (
        <NumberField
          key={axis}
          label={axis}
          signed
          value={value[i] as number}
          testId={`position-${axis.toLowerCase()}`}
          onChange={(next) => {
            const updated: Vec3 = [...value];
            updated[i] = next;
            onChange(updated);
          }}
        />
      ))}
    </div>
  );
}

function OperationField({ value, firstFeature }: { value: BooleanOperation; firstFeature: boolean }) {
  const { t } = useTranslation();
  return (
    <Segmented
      label={t('panel.operation')}
      value={value}
      disabled={firstFeature}
      options={[
        { value: 'add', label: t('panel.add') },
        { value: 'cut', label: t('panel.cut') },
      ]}
      onChange={(operation) => commands.updateDraft({ operation })}
    />
  );
}

function FeatureFields({ draft, index }: { draft: Feature; index: number }) {
  const { t } = useTranslation();
  const features = useAppState((state) => state.history.features);
  const firstFeature = !hasBodyBefore(features, index);

  switch (draft.type) {
    case 'box':
      return (
        <>
          <Section title={t('panel.parameters')}>
            <OperationField value={draft.operation} firstFeature={firstFeature} />
            <NumberField label={t('panel.width')} value={draft.width} testId="box-width" onChange={(width) => commands.updateDraft({ width })} />
            <NumberField label={t('panel.depth')} value={draft.depth} testId="box-depth" onChange={(depth) => commands.updateDraft({ depth })} />
            <NumberField label={t('panel.height')} value={draft.height} testId="box-height" onChange={(height) => commands.updateDraft({ height })} />
          </Section>
          <Section title={t('panel.position')}>
            <PositionFields value={draft.position} onChange={(position) => commands.updateDraft({ position })} />
          </Section>
        </>
      );
    case 'cylinder':
      return (
        <>
          <Section title={t('panel.parameters')}>
            <OperationField value={draft.operation} firstFeature={firstFeature} />
            <NumberField label={t('panel.radius')} value={draft.radius} testId="cylinder-radius" onChange={(radius) => commands.updateDraft({ radius })} />
            <NumberField label={t('panel.height')} value={draft.height} testId="cylinder-height" onChange={(height) => commands.updateDraft({ height })} />
            <Segmented<Axis>
              label={t('panel.axis')}
              value={draft.axis}
              options={[
                { value: 'x', label: 'X' },
                { value: 'y', label: 'Y' },
                { value: 'z', label: 'Z' },
              ]}
              onChange={(axis) => commands.updateDraft({ axis })}
            />
          </Section>
          <Section title={t('panel.position')}>
            <PositionFields value={draft.position} onChange={(position) => commands.updateDraft({ position })} />
          </Section>
        </>
      );
    case 'fillet':
    case 'chamfer':
      return (
        <>
          <Section title={t('panel.parameters')}>
            {draft.type === 'fillet' ? (
              <NumberField label={t('panel.radius')} value={draft.radius} testId="fillet-radius" step={0.5} onChange={(radius) => commands.updateDraft({ radius })} />
            ) : (
              <NumberField label={t('panel.distance')} value={draft.distance} testId="chamfer-distance" step={0.5} onChange={(distance) => commands.updateDraft({ distance })} />
            )}
          </Section>
          <Section title={t('panel.edges')}>
            <div className="edge-summary">
              <span data-testid="edge-count">{t('panel.edgesCount', { count: draft.edges.length })}</span>
              <button type="button" className="text-button" disabled={draft.edges.length === 0} onClick={() => commands.updateDraft({ edges: [] })}>
                {t('panel.clearEdges')}
              </button>
            </div>
            <p className="panel-hint">{t('panel.edgesHint')}</p>
          </Section>
        </>
      );
  }
}

export function PropertyPanel() {
  const { t } = useTranslation();
  const edit = useAppState((state) => state.activeEdit);
  const result = useAppState((state) => (state.activeEdit ? state.rebuild?.results[state.activeEdit.index] : undefined));
  if (!edit) return null;

  const Icon = FEATURE_ICONS[edit.draft.type];
  const featureLabel = t(`features.${edit.draft.type}`);
  const title = edit.mode === 'create' ? t('panel.creating', { feature: featureLabel }) : t('panel.editing', { feature: featureLabel });
  const error = result?.id === edit.draft.id && result.status === 'error' ? result.error : undefined;

  return (
    <section
      className="panel property-panel"
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commands.commitEdit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          commands.cancelEdit();
        }
      }}
    >
      <div className="property-header">
        <Icon className="property-icon" />
        <h2 className="panel-title">{title}</h2>
        <div className="confirm-buttons">
          <button type="button" className="confirm-button is-ok" title={`${t('panel.ok')} (Enter)`} aria-label={t('panel.ok')} data-testid="panel-ok" onClick={commands.commitEdit}>
            <CheckIcon />
          </button>
          <button type="button" className="confirm-button is-cancel" title={`${t('panel.cancel')} (Esc)`} aria-label={t('panel.cancel')} data-testid="panel-cancel" onClick={commands.cancelEdit}>
            <CloseIcon />
          </button>
        </div>
      </div>
      {error ? (
        <div className="panel-error" role="alert">
          {t(`errors.${error.code}`, { detail: error.detail ?? '' })}
        </div>
      ) : null}
      <FeatureFields draft={edit.draft} index={edit.index} />
    </section>
  );
}
