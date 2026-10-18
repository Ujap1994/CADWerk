import type { Feature, FeatureType } from '../../../shared/model/feature.ts';

/** Undo steps kept per document. */
export const HISTORY_LIMIT = 200;

export interface History {
  features: Feature[];
  past: Feature[][];
  future: Feature[][];
}

export function emptyHistory(features: Feature[] = []): History {
  return { features, past: [], future: [] };
}

export function commit(history: History, features: Feature[]): History {
  return { features, past: [...history.past, history.features].slice(-HISTORY_LIMIT), future: [] };
}

export function undo(history: History): History {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return { features: previous, past: history.past.slice(0, -1), future: [history.features, ...history.future] };
}

export function redo(history: History): History {
  const next = history.future[0];
  if (!next) return history;
  return { features: next, past: [...history.past, history.features], future: history.future.slice(1) };
}

/** A feature being created or edited in the property panel. */
export interface ActiveEdit {
  mode: 'create' | 'edit';
  /** Position of the draft in the feature list. */
  index: number;
  draft: Feature;
}

export interface RebuildPlan {
  features: Feature[];
  /** Feature indices whose resulting body is needed (see CapturedState). */
  captures: number[];
}

/**
 * What the kernel has to build for the current state.
 *
 * While a feature is edited, everything after it is rolled back and the body
 * before the feature is captured too, so its edges can be picked.
 */
export function rebuildPlan(features: Feature[], edit: ActiveEdit | null): RebuildPlan {
  if (!edit) return { features, captures: [features.length - 1] };
  const before = features.slice(0, edit.index);
  return { features: [...before, edit.draft], captures: [edit.index - 1, edit.index] };
}

export function applyEdit(features: Feature[], edit: ActiveEdit): Feature[] {
  const next = [...features];
  if (edit.mode === 'create') next.splice(edit.index, 0, edit.draft);
  else next[edit.index] = edit.draft;
  return next;
}

/** 1-based number of a feature among features of the same type, for default names like "Fillet2". */
export function featureOrdinal(features: readonly Feature[], index: number): number {
  const type: FeatureType | undefined = features[index]?.type;
  let count = 0;
  for (let i = 0; i <= index; i++) if (features[i]?.type === type) count++;
  return count;
}

export function hasBodyBefore(features: readonly Feature[], index: number): boolean {
  return features.slice(0, index).some((feature) => !feature.suppressed && (feature.type === 'box' || feature.type === 'cylinder'));
}
