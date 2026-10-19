import { resolveLanguage } from '../../shared/i18n.ts';
import type { MenuCommand } from '../../shared/ipc.ts';
import { PART_FILE_EXTENSION } from '../../shared/app-info.ts';
import { defaultFeature, isEdgeFeature, type EdgeRef, type Feature, type FeatureType, type SketchFeature } from '../../shared/model/feature.ts';
import { decodePartFile, encodePartFile, PartFileError } from '../../shared/model/part-file.ts';
import { frameOnPlane, isDimension, ORIGIN_ID, STANDARD_PLANES, type SketchData, type SketchDimension, type SketchPlaneRef } from '../../shared/model/sketch.ts';
import type { Settings } from '../../shared/settings.ts';
import { changeLanguage, t } from './i18n.ts';
import { SketchBuilder } from './sketch/builder.ts';
import { storedAngle, type DimensionDraft } from './sketch/dimensions.ts';
import { curvePoints, deleteEntities, isCurve } from './sketch/geometry.ts';
import { applicableRelations, type RelationKind } from './sketch/relations.ts';
import { sketchSolver } from './sketch/solver.ts';
import { dxfToSketch, sketchToDxf } from './sketch/dxf.ts';
import { offsetSelection } from './sketch/offset.ts';
import { circularPattern, copySelection, linearPattern, mirrorSelection, movedPoints, scaledCopy, scaledInPlace, type TransformResult } from './sketch/transform.ts';
import { sameGeometry } from './sketch/drag.ts';
import type { Point2 } from './sketch/geometry.ts';
import {
  applySketchSession,
  hasSketchChanges,
  openSketchSession,
  recordSketch,
  redoSketch,
  undoSketch,
  type SketchSession,
} from './sketch/session.ts';
import { applyEdit, commit, emptyHistory, hasBodyBefore, redo as redoHistory, undo as undoHistory } from './state/document.ts';
import { kernel, whenIdle } from './state/rebuild.ts';
import { getState, setHistory, setState, showToast, type AppState, type CommandTab, type Pick } from './state/store.ts';
import type { SketchToolName } from './sketch/tools.ts';
import { sketchToolControl, viewport } from './viewport/registry.ts';
import type { StandardView } from './viewport/views.ts';

const api = () => window.parawerk;

function baseName(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  return name.replace(/\.[^.]+$/, '');
}

/** State that leaves every mode (feature edit, sketch) without storing anything. */
function closedModes(): Partial<AppState> {
  return {
    activeEdit: null,
    sketch: null,
    choosingSketchPlane: false,
    selection: [],
    hover: null,
    sketchSelection: [],
    sketchHover: null,
    sketchTool: null,
    commandTab: 'features',
  };
}

function documentName(): string {
  return getState().fileName ?? t('app.untitled');
}

function isTextInputFocused(): boolean {
  const element = document.activeElement;
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
}

async function confirmDiscard(): Promise<boolean> {
  if (!getState().dirty) return true;
  return api().confirm({
    message: t('dialogs.discardMessage'),
    detail: t('dialogs.discardDetail', { name: documentName() }),
    confirmLabel: t('dialogs.discard'),
    cancelLabel: t('dialogs.cancel'),
  });
}

// ------------------------------------------------------------------ documents

export async function newDocument(): Promise<void> {
  if (!(await confirmDiscard())) return;
  const history = emptyHistory();
  setState({ history, savedFeatures: history.features, dirty: false, filePath: null, fileName: null, ...closedModes() });
  viewport()?.requestFitOnNextBody();
  viewport()?.setStandardView('isometric');
}

export function loadDocument(path: string, data: Uint8Array): void {
  try {
    const { document } = decodePartFile(data);
    const history = emptyHistory(document.features);
    setState({
      history,
      savedFeatures: history.features,
      dirty: false,
      filePath: path,
      fileName: baseName(path),
      ...closedModes(),
    });
    viewport()?.requestFitOnNextBody();
    showToast('success', t('toasts.opened', { name: baseName(path) }));
  } catch (error) {
    const message =
      error instanceof PartFileError ? t(`fileErrors.${error.code}`, { detail: error.message }) : error instanceof Error ? error.message : String(error);
    showToast('error', t('toasts.openFailed', { message }));
  }
}

export async function openDocument(): Promise<void> {
  if (!(await confirmDiscard())) return;
  const result = await api().openFile({
    title: t('dialogs.openTitle'),
    filters: [{ name: t('dialogs.partFiles'), extensions: [PART_FILE_EXTENSION] }],
  });
  if (result.status === 'opened') loadDocument(result.path, result.data);
  else if (result.status === 'error') showToast('error', t('toasts.openFailed', { message: result.message }));
}

export async function openFromSystem(path: string, data: Uint8Array): Promise<void> {
  if (!(await confirmDiscard())) return;
  loadDocument(path, data);
}

export async function saveDocument(saveAs = false): Promise<boolean> {
  if (getState().activeEdit) commitEdit();
  storeOpenSketch();
  const state = getState();
  const data = encodePartFile(
    { units: 'mm', features: state.history.features },
    { appVersion: state.appInfo?.version ?? 'dev', savedAt: new Date().toISOString() },
  );
  const result = await api().saveFile({
    title: t('dialogs.saveTitle'),
    defaultName: `${documentName()}.${PART_FILE_EXTENSION}`,
    filters: [{ name: t('dialogs.partFiles'), extensions: [PART_FILE_EXTENSION] }],
    data,
    ...(saveAs || !state.filePath ? {} : { path: state.filePath }),
  });
  if (result.status === 'saved') {
    setState({ filePath: result.path, fileName: baseName(result.path), savedFeatures: state.history.features, dirty: false });
    showToast('success', t('toasts.saved', { name: baseName(result.path) }));
    return true;
  }
  if (result.status === 'error') showToast('error', t('toasts.saveFailed', { message: result.message }));
  return false;
}

export async function exportModel(format: 'step' | 'stl'): Promise<void> {
  const features = getState().history.features;
  let data: Uint8Array;
  try {
    await whenIdle();
    data = await kernel().exportModel({ features, format });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showToast('error', message === 'nothing-to-export' ? t('toasts.nothingToExport') : t('toasts.exportFailed', { message }));
    return;
  }
  const extension = format === 'step' ? 'step' : 'stl';
  const result = await api().saveFile({
    title: t('dialogs.exportTitle'),
    defaultName: `${documentName()}.${extension}`,
    filters: [{ name: t(format === 'step' ? 'dialogs.stepFiles' : 'dialogs.stlFiles'), extensions: format === 'step' ? ['step', 'stp'] : ['stl'] }],
    data,
  });
  if (result.status === 'saved') showToast('success', t('toasts.exported', { name: result.path.split(/[\\/]/).pop() ?? result.path }));
  else if (result.status === 'error') showToast('error', t('toasts.exportFailed', { message: result.message }));
}

// ------------------------------------------------------------------ features

export function startFeature(type: FeatureType): void {
  if (type === 'sketch') {
    startSketch();
    return;
  }
  const state = getState();
  if (state.sketch || state.choosingSketchPlane) return;
  if (state.activeEdit) commitEdit();
  const features = getState().history.features;
  const index = features.length;
  let draft: Feature = defaultFeature(type);
  if (isEdgeFeature(draft)) {
    // Edges selected before starting the command are taken over (select first, then act).
    const edges: EdgeRef[] = getState()
      .selection.filter((pick) => pick.kind === 'edge')
      .map((pick) => ({ kind: 'edge-index', index: pick.index }));
    draft = { ...draft, edges };
  } else if (!hasBodyBefore(features, index) && (draft.type === 'box' || draft.type === 'cylinder')) {
    draft = { ...draft, operation: 'add' };
  }
  setState({ activeEdit: { mode: 'create', index, draft }, selection: [] });
}

export function editFeature(id: string): void {
  if (getState().sketch) return;
  if (getState().activeEdit) cancelEdit();
  const features = getState().history.features;
  const index = features.findIndex((feature) => feature.id === id);
  const feature = features[index];
  if (!feature) return;
  if (feature.type === 'sketch') {
    enterSketch(openSketchSession('edit', index, feature));
    return;
  }
  setState({ activeEdit: { mode: 'edit', index, draft: feature }, selection: [], choosingSketchPlane: false });
}

export function updateDraft(patch: Partial<Feature>): void {
  const edit = getState().activeEdit;
  if (!edit) return;
  setState({ activeEdit: { ...edit, draft: { ...edit.draft, ...patch } as Feature } });
}

export function toggleDraftEdge(index: number): void {
  const edit = getState().activeEdit;
  if (!edit || !isEdgeFeature(edit.draft)) return;
  const exists = edit.draft.edges.some((ref) => ref.index === index);
  const edges = exists ? edit.draft.edges.filter((ref) => ref.index !== index) : [...edit.draft.edges, { kind: 'edge-index' as const, index }];
  updateDraft({ edges });
}

export function commitEdit(): void {
  const state = getState();
  const edit = state.activeEdit;
  if (!edit) return;
  const unchanged = edit.mode === 'edit' && state.history.features[edit.index] === edit.draft;
  if (unchanged) {
    setState({ activeEdit: null });
    return;
  }
  setHistory(commit(state.history, applyEdit(state.history.features, edit)), { activeEdit: null });
}

export function cancelEdit(): void {
  if (getState().activeEdit) setState({ activeEdit: null });
}

export function deleteFeature(id: string): void {
  const state = getState();
  if (state.sketch) return;
  if (state.activeEdit) cancelEdit();
  const features = state.history.features.filter((feature) => feature.id !== id);
  setHistory(commit(state.history, features));
}

export function toggleSuppress(id: string): void {
  const state = getState();
  if (state.sketch) return;
  const features = state.history.features.map((feature) =>
    feature.id === id ? ({ ...feature, suppressed: !feature.suppressed } as Feature) : feature,
  );
  setHistory(commit(state.history, features));
}

export function undo(): void {
  if (isTextInputFocused()) {
    document.execCommand('undo');
    return;
  }
  const { sketch } = getState();
  if (sketch) {
    updateSketch(undoSketch(sketch), { sketchSelection: [], sketchHover: null });
    return;
  }
  if (getState().choosingSketchPlane) {
    setState({ choosingSketchPlane: false });
    return;
  }
  if (getState().activeEdit) {
    cancelEdit();
    return;
  }
  setHistory(undoHistory(getState().history), { selection: [] });
}

export function redo(): void {
  if (isTextInputFocused()) {
    document.execCommand('redo');
    return;
  }
  const { sketch } = getState();
  if (sketch) {
    updateSketch(redoSketch(sketch), { sketchSelection: [], sketchHover: null });
    return;
  }
  if (getState().activeEdit || getState().choosingSketchPlane) return;
  setHistory(redoHistory(getState().history), { selection: [] });
}

// ------------------------------------------------------------------ sketches

/** Where a picked plane or planar face lies, or null if a sketch cannot be placed on the pick. */
function sketchPlaneOf(pick: Pick): SketchPlaneRef | null {
  if (pick.kind === 'plane') {
    const plane = STANDARD_PLANES[pick.index];
    return plane ? { kind: 'standard', plane } : null;
  }
  if (pick.kind !== 'face') return null;
  const face = getState().display.body?.faceInfo[pick.index]?.plane;
  return face ? { kind: 'face', face: pick.index, frame: frameOnPlane(face.point, face.normal) } : null;
}

/** Sketch command: sketches on a selected plane or planar face right away, otherwise asks for one. */
export function startSketch(): void {
  const state = getState();
  if (state.sketch) return;
  if (state.activeEdit) commitEdit();
  const selected = getState().selection;
  const plane = selected.length === 1 && selected[0] ? sketchPlaneOf(selected[0]) : null;
  if (plane) chooseSketchPlane(plane);
  else setState({ choosingSketchPlane: true, selection: [], hover: null, commandTab: 'sketch' });
}

/** Opens a new sketch on `plane`, behind the last feature. */
export function chooseSketchPlane(plane: SketchPlaneRef): void {
  if (getState().sketch) return;
  const draft: SketchFeature = { ...(defaultFeature('sketch') as SketchFeature), plane };
  enterSketch(openSketchSession('create', getState().history.features.length, draft));
}

function enterSketch(session: SketchSession): void {
  updateSketch(session, {
    activeEdit: null,
    choosingSketchPlane: false,
    selection: [],
    hover: null,
    sketchSelection: [],
    sketchHover: null,
    sketchTool: null,
    commandTab: 'sketch',
  });
}

/** Replaces the sketch session and keeps the dirty flag in sync with unsaved sketch work. */
function updateSketch(sketch: SketchSession | null, extra: Partial<AppState> = {}): void {
  setState((state) => ({
    ...extra,
    sketch,
    dirty: state.history.features !== state.savedFeatures || (sketch !== null && hasSketchChanges(sketch, state.history.features)),
  }));
}

/** Records one finished sketch operation (one undo step in sketch mode). */
export function recordSketchChange(sketch: SketchData): void {
  const session = getState().sketch;
  if (session) updateSketch(recordSketch(session, sketch));
}

/** Leaves sketch mode and keeps the sketch: one step in the document history. An empty new sketch is dropped. */
export function exitSketch(): void {
  const state = getState();
  const session = state.sketch;
  if (!session) {
    if (state.choosingSketchPlane) setState({ choosingSketchPlane: false, commandTab: 'features' });
    return;
  }
  const leave: Partial<AppState> = { selection: [], hover: null, sketchSelection: [], sketchHover: null, sketchTool: null, commandTab: 'features' };
  const features = applySketchSession(state.history.features, session);
  if (features) setHistory(commit(state.history, features), { ...leave, sketch: null });
  else updateSketch(null, leave);
}

/** Leaves sketch mode and discards its changes (after asking, if there are any). */
export async function cancelSketch(): Promise<void> {
  const state = getState();
  const session = state.sketch;
  if (!session) {
    if (state.choosingSketchPlane) setState({ choosingSketchPlane: false, commandTab: 'features' });
    return;
  }
  if (hasSketchChanges(session, state.history.features)) {
    const confirmed = await api().confirm({
      message: t('dialogs.discardSketchMessage'),
      detail: t('dialogs.discardSketchDetail'),
      confirmLabel: t('dialogs.discard'),
      cancelLabel: t('dialogs.cancel'),
    });
    if (!confirmed || getState().sketch !== session) return;
  }
  updateSketch(null, { selection: [], hover: null, sketchSelection: [], sketchHover: null, sketchTool: null, commandTab: 'features' });
}

/** Activates a drawing tool (null: select and drag). Choosing the active tool again leaves it. */
export function setSketchTool(tool: SketchToolName | null): void {
  const state = getState();
  if (!state.sketch) return;
  const next = tool === state.sketchTool ? null : tool;
  const variants = { ...state.sketchToolVariants };
  if (next === 'line' || next === 'centerline') variants.line = next;
  if (next === 'cornerRectangle' || next === 'centerRectangle' || next === 'threePointRectangle' || next === 'parallelogram') variants.rectangle = next;
  if (next === 'circle' || next === 'threePointCircle' || next === 'ellipse') variants.circle = next;
  if (next === 'centerArc' || next === 'threePointArc' || next === 'tangentArc') variants.arc = next;
  if (next === 'sketchFillet' || next === 'sketchChamfer') variants.corner = next;
  if (next === 'trim' || next === 'extend') variants.trim = next;
  setState({ sketchTool: next, sketchToolVariants: variants, sketchSelection: next ? [] : state.sketchSelection, sketchHover: null, commandTab: 'sketch' });
}

export function setCornerSize(tool: 'sketchFillet' | 'sketchChamfer', size: number): void {
  if (!(size > 0)) return;
  setState(tool === 'sketchFillet' ? { filletRadius: size } : { chamferDistance: size });
}

export function setPolygonSides(sides: number): void {
  if (Number.isFinite(sides)) setState({ polygonSides: Math.max(3, Math.min(64, Math.round(sides))) });
}

/** Turns the selected curves into construction geometry, or back if all of them already are. */
export function toggleConstruction(): void {
  const { sketch, sketchSelection } = getState();
  if (!sketch || sketchSelection.length === 0) return;
  const selected = new Set(sketchSelection);
  const curves = sketch.draft.sketch.entities.filter((entity) => selected.has(entity.id) && entity.type !== 'point');
  if (curves.length === 0) return;
  const construction = !curves.every((curve) => curve.construction);
  const entities = sketch.draft.sketch.entities.map((entity) => {
    if (!selected.has(entity.id) || entity.type === 'point') return entity;
    const { construction: _old, ...rest } = entity;
    return construction ? { ...rest, construction: true } : rest;
  });
  recordSketchChange({ ...sketch.draft.sketch, entities });
}

/** Clicking sketch geometry: select it, add or remove it (additive), or clear the selection (null). */
export function selectSketchEntity(id: string | null, additive: boolean): void {
  const { sketch, sketchSelection } = getState();
  if (!sketch) return;
  if (!id) {
    if (!additive && sketchSelection.length > 0) setState({ sketchSelection: [] });
    return;
  }
  const selected = sketchSelection.includes(id);
  if (additive) setState({ sketchSelection: selected ? sketchSelection.filter((other) => other !== id) : [...sketchSelection, id] });
  else setState({ sketchSelection: selected && sketchSelection.length === 1 ? [] : [id] });
}

/**
 * Adds a relation to the selected geometry. The solver checks it first: a relation that already
 * follows from others (it would over-define the sketch) or contradicts them is refused with a message.
 */
export async function addSketchRelation(kind: RelationKind): Promise<void> {
  const { sketch, sketchSelection } = getState();
  if (!sketch) return;
  const base = sketch.draft.sketch;
  const option = applicableRelations(base, sketchSelection).find((candidate) => candidate.kind === kind);
  if (!option) return;
  const builder = new SketchBuilder(base);
  for (const relation of option.relations) builder.relation(relation);
  const next = builder.build();
  const added = next.constraints.slice(base.constraints.length);
  try {
    const solver = sketchSolver();
    for (const [i, candidate] of added.entries()) {
      const before = { entities: base.entities, constraints: [...base.constraints, ...added.slice(0, i)] };
      if (await solver.isRedundant(before, candidate)) {
        showToast('info', t('sketch.messages.redundantRelation'));
        return;
      }
    }
    const solution = await solver.solve(next, { analyze: false });
    if (!solution.converged) {
      showToast('error', t('sketch.messages.conflictingRelation'));
      return;
    }
    // The sketch changed while the solver worked (undo, another edit): do not apply on top of it.
    if (getState().sketch?.draft.sketch !== base) return;
    recordSketchChange(solution.sketch);
  } catch (error) {
    showToast('error', t('errors.unknown', { detail: error instanceof Error ? error.message : String(error) }));
  }
}

/** A typed dimension value in solver units: millimeters, or degrees turned into the stored angle. Null if invalid. */
function dimensionValue(sketch: SketchData, dimension: DimensionDraft, typed: number): number | null {
  if (dimension.type === 'angle') return typed > 0 && typed < 180 ? storedAngle(sketch, dimension, (typed * Math.PI) / 180) : null;
  return typed > 0 ? typed : null;
}

function replaceConstraint(sketch: SketchData, constraint: SketchDimension): SketchData {
  return { ...sketch, constraints: sketch.constraints.map((other) => (other.id === constraint.id ? constraint : other)) };
}

/**
 * Adds a dimension and applies the typed value (null keeps the measured one). A dimension that
 * would over-define the sketch becomes a driven (reference) dimension that only shows the value.
 */
export async function addSketchDimension(draft: DimensionDraft, typed: number | null): Promise<void> {
  const session = getState().sketch;
  if (!session) return;
  const base = session.draft.sketch;
  const builder = new SketchBuilder(base);
  builder.dimension(draft);
  const measured = builder.build();
  const probe = measured.constraints.at(-1) as SketchDimension;
  try {
    const solver = sketchSolver();
    if (await solver.isRedundant(base, probe)) {
      if (getState().sketch?.draft.sketch === base) recordSketchChange({ ...base, constraints: [...base.constraints, { ...probe, driving: false }] });
      showToast('info', t('sketch.messages.drivenDimension'));
      return;
    }
    const value = typed === null ? probe.value : dimensionValue(base, probe, typed);
    if (value === null) showToast('error', t('sketch.messages.invalidDimension'));
    const next = value === null ? measured : replaceConstraint(measured, { ...probe, value });
    const solution = await solver.solve(next, { analyze: false });
    if (getState().sketch?.draft.sketch !== base) return;
    if (solution.converged) {
      recordSketchChange(solution.sketch);
    } else {
      showToast('error', t('sketch.messages.dimensionNotApplied'));
      recordSketchChange(measured);
    }
  } catch (error) {
    showToast('error', t('errors.unknown', { detail: error instanceof Error ? error.message : String(error) }));
  }
}

/** Changes the value of a driving dimension; the geometry follows if the sketch can be solved. */
export async function setSketchDimensionValue(id: string, typed: number): Promise<void> {
  const session = getState().sketch;
  if (!session) return;
  const base = session.draft.sketch;
  const dimension = base.constraints.find((constraint) => constraint.id === id);
  if (!dimension || !isDimension(dimension)) return;
  if (!dimension.driving) {
    showToast('info', t('sketch.messages.drivenNotEditable'));
    return;
  }
  const value = dimensionValue(base, dimension, typed);
  if (value === null) {
    showToast('error', t('sketch.messages.invalidDimension'));
    return;
  }
  try {
    const solution = await sketchSolver().solve(replaceConstraint(base, { ...dimension, value }), { analyze: false });
    if (getState().sketch?.draft.sketch !== base) return;
    if (solution.converged) recordSketchChange(solution.sketch);
    else showToast('error', t('sketch.messages.dimensionNotApplied'));
  } catch (error) {
    showToast('error', t('errors.unknown', { detail: error instanceof Error ? error.message : String(error) }));
  }
}

const TRANSFORM_MESSAGES = { 'nothing-selected': 'transformNothing', 'no-axis': 'transformNoAxis' } as const;

function applyTransform(result: TransformResult): void {
  if (result.ok) recordSketchChange(result.sketch);
  else showToast('info', t(`sketch.messages.${TRANSFORM_MESSAGES[result.error]}`));
}

/**
 * The pivot of the selection for rotations and circular patterns: a selected stand-alone point
 * (which is then not copied), or the sketch origin.
 */
export function selectionPivot(): { at: Point2; point: string | null } {
  const { sketch, sketchSelection } = getState();
  const data = sketch?.draft.sketch;
  if (!data) return { at: [0, 0], point: null };
  const selected = new Set(sketchSelection);
  const ofSelectedCurves = new Set(data.entities.flatMap((entity) => (isCurve(entity) && selected.has(entity.id) ? curvePoints(entity) : [])));
  const points = data.entities.filter((entity) => entity.type === 'point' && selected.has(entity.id) && !ofSelectedCurves.has(entity.id));
  const [only] = points;
  return points.length === 1 && only?.type === 'point' && sketchSelection.length > 1 ? { at: [only.x, only.y], point: only.id } : { at: [0, 0], point: null };
}

/** Name of the open sketch for file names: its own name or "Sketch2". */
function openSketchName(): string {
  const { sketch, history } = getState();
  if (!sketch) return t('features.sketch');
  const before = history.features.slice(0, sketch.index).filter((feature) => feature.type === 'sketch').length;
  return sketch.draft.name ?? `${t('features.sketch')}${before + 1}`;
}

/** Adds the lines, circles, arcs and polylines of a DXF file to the open sketch. */
export async function importDxfIntoSketch(): Promise<void> {
  if (!getState().sketch) return;
  const result = await api().openFile({ title: t('dialogs.importDxfTitle'), filters: [{ name: t('dialogs.dxfFiles'), extensions: ['dxf'] }] });
  if (result.status === 'error') showToast('error', t('toasts.openFailed', { message: result.message }));
  if (result.status !== 'opened') return;
  const session = getState().sketch;
  if (!session) return;
  try {
    const imported = dxfToSketch(new TextDecoder().decode(result.data), session.draft.sketch);
    recordSketchChange(imported.sketch);
    const skipped = Object.entries(imported.skipped)
      .map(([type, count]) => `${count} × ${type}`)
      .join(', ');
    showToast('success', t(skipped ? 'toasts.dxfImportedSkipped' : 'toasts.dxfImported', { count: imported.imported, skipped }));
    viewport()?.zoomToFit();
  } catch (error) {
    showToast('error', t('toasts.openFailed', { message: error instanceof Error ? error.message : String(error) }));
  }
}

/** Saves the open sketch as DXF (without construction geometry). */
export async function exportSketchDxf(): Promise<void> {
  const session = getState().sketch;
  if (!session) return;
  const { text } = sketchToDxf(session.draft.sketch);
  const result = await api().saveFile({
    title: t('dialogs.exportTitle'),
    defaultName: `${openSketchName()}.dxf`,
    filters: [{ name: t('dialogs.dxfFiles'), extensions: ['dxf'] }],
    data: new TextEncoder().encode(text),
  });
  if (result.status === 'saved') showToast('success', t('toasts.exported', { name: result.path.split(/[\\/]/).pop() ?? result.path }));
  else if (result.status === 'error') showToast('error', t('toasts.exportFailed', { message: result.message }));
}

/** Offsets the selected curves; closed outlines grow outwards unless `flip`. */
export function offsetSketchSelection(distance: number, flip: boolean): void {
  const { sketch, sketchSelection } = getState();
  if (!sketch) return;
  const result = offsetSelection(sketch.draft.sketch, sketchSelection, distance, flip);
  if (result.ok) recordSketchChange(result.sketch);
  else showToast('info', t(`sketch.messages.${result.error === 'too-large' ? 'offsetTooLarge' : 'transformNothing'}`));
}

export function mirrorSketchSelection(): void {
  const { sketch, sketchSelection } = getState();
  if (sketch) applyTransform(mirrorSelection(sketch.draft.sketch, sketchSelection));
}

export function patternSketchSelection(pattern: { kind: 'linear'; step: Point2; count: number } | { kind: 'circular'; count: number; angle: number }): void {
  const { sketch, sketchSelection } = getState();
  if (!sketch) return;
  if (pattern.kind === 'linear') {
    applyTransform(linearPattern(sketch.draft.sketch, sketchSelection, pattern.step, pattern.count));
    return;
  }
  const pivot = selectionPivot();
  const ids = sketchSelection.filter((id) => id !== pivot.point);
  applyTransform(circularPattern(sketch.draft.sketch, ids, pivot.at, pattern.count, (pattern.angle * Math.PI) / 180));
}

/** Copies the selection shifted by `offset` and rotated by `angle` (degrees) around the pivot. */
export function copySketchSelection(offset: Point2, angle: number): void {
  const { sketch, sketchSelection } = getState();
  if (!sketch) return;
  const pivot = selectionPivot();
  applyTransform(copySelection(sketch.draft.sketch, sketchSelection.filter((id) => id !== pivot.point), offset, (angle * Math.PI) / 180, pivot.at));
}

/** Moves the selection like a drag would: relations and dimensions are kept, held geometry stays. */
export async function moveSketchSelection(offset: Point2, angle: number): Promise<void> {
  const { sketch, sketchSelection } = getState();
  if (!sketch) return;
  const base = sketch.draft.sketch;
  const pivot = selectionPivot();
  const points = movedPoints(base, sketchSelection.filter((id) => id !== pivot.point), offset, (angle * Math.PI) / 180, pivot.at);
  if (points.length === 0) {
    showToast('info', t('sketch.messages.transformNothing'));
    return;
  }
  try {
    const solution = await sketchSolver().solve(base, { drag: { kind: 'points', points }, analyze: false });
    if (getState().sketch?.draft.sketch !== base) return;
    if (solution.converged && !sameGeometry(solution.sketch, base)) recordSketchChange(solution.sketch);
    else showToast('info', t('sketch.messages.moveBlocked'));
  } catch (error) {
    showToast('error', t('errors.unknown', { detail: error instanceof Error ? error.message : String(error) }));
  }
}

/**
 * Scales the selection by `factor` around the pivot: as a copy, or in place (dimensions within the
 * selection scale along; relations to other geometry may refuse it).
 */
export async function scaleSketchSelection(factor: number, copy: boolean): Promise<void> {
  const { sketch, sketchSelection } = getState();
  if (!sketch) return;
  const base = sketch.draft.sketch;
  const pivot = selectionPivot();
  const ids = sketchSelection.filter((id) => id !== pivot.point);
  if (copy) {
    applyTransform(scaledCopy(base, ids, factor, pivot.at));
    return;
  }
  const result = scaledInPlace(base, ids, factor, pivot.at, pivot.point ?? ORIGIN_ID);
  if (!result.ok) {
    applyTransform(result);
    return;
  }
  try {
    const solution = await sketchSolver().solve(result.sketch, { analyze: false });
    if (getState().sketch?.draft.sketch !== base) return;
    if (solution.converged && solution.unsatisfied.length === 0) recordSketchChange(solution.sketch);
    else showToast('info', t('sketch.messages.scaleBlocked'));
  } catch (error) {
    showToast('error', t('errors.unknown', { detail: error instanceof Error ? error.message : String(error) }));
  }
}

/** Removes one relation or dimension of the open sketch. */
export function deleteSketchConstraint(id: string): void {
  const { sketch, sketchSelection } = getState();
  if (!sketch) return;
  setState({ sketchSelection: sketchSelection.filter((other) => other !== id), sketchHover: null });
  recordSketchChange(deleteEntities(sketch.draft.sketch, [id]));
}

/** Highlights sketch geometry or a relation from outside the view (e.g. the relation list). */
export function hoverSketchEntity(id: string | null): void {
  if (getState().sketch && getState().sketchHover !== id) setState({ sketchHover: id });
}

/** Deletes the selected sketch geometry with everything that depends on it. */
export function deleteSketchSelection(): void {
  const { sketch, sketchSelection } = getState();
  if (!sketch || sketchSelection.length === 0) return;
  const next = deleteEntities(sketch.draft.sketch, sketchSelection);
  setState({ sketchSelection: [], sketchHover: null });
  recordSketchChange(next);
}

/** Stores the open sketch in the document without leaving sketch mode (before saving). */
function storeOpenSketch(): void {
  const state = getState();
  const session = state.sketch;
  if (!session) return;
  const features = applySketchSession(state.history.features, session);
  if (features) setHistory(commit(state.history, features), { sketch: { ...session, mode: 'edit' } });
}

export function setCommandTab(commandTab: CommandTab): void {
  setState({ commandTab });
}

// ------------------------------------------------------------------ selection

export function handlePick(pick: Pick | null, additive: boolean): void {
  const state = getState();
  if (state.choosingSketchPlane) {
    const plane = pick ? sketchPlaneOf(pick) : null;
    if (plane) chooseSketchPlane(plane);
    return;
  }
  // Sketch geometry is picked by the sketch layer, not here.
  if (state.sketch) return;
  const edit = state.activeEdit;
  if (edit && isEdgeFeature(edit.draft)) {
    if (pick?.kind === 'edge') toggleDraftEdge(pick.index);
    return;
  }
  if (edit) return;
  if (!pick) {
    if (!additive) setState({ selection: [] });
    return;
  }
  const exists = state.selection.some((s) => s.kind === pick.kind && s.index === pick.index);
  if (additive) {
    setState({ selection: exists ? state.selection.filter((s) => !(s.kind === pick.kind && s.index === pick.index)) : [...state.selection, pick] });
  } else {
    setState({ selection: exists && state.selection.length === 1 ? [] : [pick] });
  }
}

export function escape(): void {
  const state = getState();
  if (state.choosingSketchPlane) void cancelSketch();
  else if (state.sketch) {
    if (!sketchToolControl()?.escape()) setState({ sketchSelection: [] });
  }
  else if (state.activeEdit) cancelEdit();
  else setState({ selection: [] });
}

/** Hovering a plane in the feature tree shows it in the view. */
export function hoverPlane(index: number | null): void {
  const hover = getState().hover;
  if (index === null) {
    if (hover?.kind === 'plane') setState({ hover: null });
  } else if (hover?.kind !== 'plane' || hover.index !== index) {
    setState({ hover: { kind: 'plane', index } });
  }
}

// ------------------------------------------------------------------ settings and views

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const settings = await api().setSettings(patch);
  const systemLocale = getState().appInfo?.systemLocale ?? navigator.language;
  const language = resolveLanguage(settings.language, systemLocale);
  if (language !== getState().language) await changeLanguage(language);
  setState({ settings, language });
}

export function setView(view: StandardView): void {
  viewport()?.setStandardView(view);
}

export function zoomToFit(): void {
  viewport()?.zoomToFit();
}

export function openDialog(dialog: 'settings' | 'about'): void {
  setState((state) => ({ dialogs: { ...state.dialogs, [dialog]: true } }));
}

export function closeDialog(dialog: 'settings' | 'about'): void {
  setState((state) => ({ dialogs: { ...state.dialogs, [dialog]: false } }));
}

export function runMenuCommand(command: MenuCommand): void {
  switch (command) {
    case 'file.new':
      void newDocument();
      break;
    case 'file.open':
      void openDocument();
      break;
    case 'file.save':
      void saveDocument(false);
      break;
    case 'file.saveAs':
      void saveDocument(true);
      break;
    case 'file.exportStep':
      void exportModel('step');
      break;
    case 'file.exportStl':
      void exportModel('stl');
      break;
    case 'edit.undo':
      undo();
      break;
    case 'edit.redo':
      redo();
      break;
    case 'view.zoomToFit':
      zoomToFit();
      break;
    case 'view.front':
    case 'view.back':
    case 'view.left':
    case 'view.right':
    case 'view.top':
    case 'view.bottom':
    case 'view.isometric':
      setView(command.slice(5) as StandardView);
      break;
    case 'view.toggleProjection':
      void updateSettings({ projection: getState().settings.projection === 'perspective' ? 'orthographic' : 'perspective' });
      break;
    case 'view.toggleFrameStats':
      void updateSettings({ showFrameStats: !getState().settings.showFrameStats });
      break;
    case 'view.toggleSketchRelations':
      void updateSettings({ showSketchRelations: !getState().settings.showSketchRelations });
      break;
    case 'app.settings':
      openDialog('settings');
      break;
    case 'app.about':
      openDialog('about');
      break;
  }
}
