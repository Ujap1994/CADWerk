import type { Feature, SketchFeature } from '../../../shared/model/feature.ts';
import type { SketchData } from '../../../shared/model/sketch.ts';
import { HISTORY_LIMIT } from '../state/document.ts';

/**
 * A sketch open in sketch mode. Sketch mode has its own undo history: every
 * finished operation (a drawn line, a drag, a new relation) is one step, and
 * the whole session becomes a single step of the document history on exit.
 */
export interface SketchSession {
  mode: 'create' | 'edit';
  /** Position of the sketch in the feature list; later features are rolled back. */
  index: number;
  draft: SketchFeature;
  past: SketchData[];
  future: SketchData[];
}

export function openSketchSession(mode: SketchSession['mode'], index: number, draft: SketchFeature): SketchSession {
  return { mode, index, draft, past: [], future: [] };
}

/** Records a finished sketch operation as one undo step. */
export function recordSketch(session: SketchSession, sketch: SketchData): SketchSession {
  if (sketch === session.draft.sketch) return session;
  return {
    ...session,
    draft: { ...session.draft, sketch },
    past: [...session.past, session.draft.sketch].slice(-HISTORY_LIMIT),
    future: [],
  };
}

export function undoSketch(session: SketchSession): SketchSession {
  const previous = session.past.at(-1);
  if (!previous) return session;
  return {
    ...session,
    draft: { ...session.draft, sketch: previous },
    past: session.past.slice(0, -1),
    future: [session.draft.sketch, ...session.future],
  };
}

export function redoSketch(session: SketchSession): SketchSession {
  const next = session.future[0];
  if (!next) return session;
  return {
    ...session,
    draft: { ...session.draft, sketch: next },
    past: [...session.past, session.draft.sketch],
    future: session.future.slice(1),
  };
}

export function isEmptySketch(sketch: SketchData): boolean {
  return sketch.entities.length === 0 && sketch.constraints.length === 0;
}

/** Whether leaving the session without saving would lose work. */
export function hasSketchChanges(session: SketchSession, features: readonly Feature[]): boolean {
  if (session.mode === 'create') return !isEmptySketch(session.draft.sketch);
  // Undo restores the stored geometry object, so undoing every step counts as unchanged.
  const stored = features[session.index];
  return stored?.type !== 'sketch' || stored.sketch !== session.draft.sketch || stored.plane !== session.draft.plane;
}

/**
 * The feature list with the session's sketch applied, or null when nothing has to be
 * stored: an empty new sketch is dropped, an unchanged edit keeps the document as it is.
 */
export function applySketchSession(features: readonly Feature[], session: SketchSession): Feature[] | null {
  if (!hasSketchChanges(session, features)) return null;
  const next = [...features];
  if (session.mode === 'create') next.splice(session.index, 0, session.draft);
  else next[session.index] = session.draft;
  return next;
}

