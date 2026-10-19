import { resolveLanguage } from '../../shared/i18n.ts';
import type { MenuCommand } from '../../shared/ipc.ts';
import { PART_FILE_EXTENSION } from '../../shared/app-info.ts';
import { defaultFeature, isEdgeFeature, type EdgeRef, type Feature, type FeatureType, type SketchFeature } from '../../shared/model/feature.ts';
import { decodePartFile, encodePartFile, PartFileError } from '../../shared/model/part-file.ts';
import { frameOnPlane, STANDARD_PLANES, type SketchData, type SketchPlaneRef } from '../../shared/model/sketch.ts';
import type { Settings } from '../../shared/settings.ts';
import { changeLanguage, t } from './i18n.ts';
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
import { viewport } from './viewport/registry.ts';
import type { StandardView } from './viewport/views.ts';

const api = () => window.parawerk;

function baseName(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  return name.replace(/\.[^.]+$/, '');
}

/** State that leaves every mode (feature edit, sketch) without storing anything. */
function closedModes(): Partial<AppState> {
  return { activeEdit: null, sketch: null, choosingSketchPlane: false, selection: [], hover: null, commandTab: 'features' };
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
    updateSketch(undoSketch(sketch));
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
    updateSketch(redoSketch(sketch));
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
  updateSketch(session, { activeEdit: null, choosingSketchPlane: false, selection: [], hover: null, commandTab: 'sketch' });
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
  const features = applySketchSession(state.history.features, session);
  if (features) setHistory(commit(state.history, features), { sketch: null, selection: [], hover: null, commandTab: 'features' });
  else updateSketch(null, { selection: [], hover: null, commandTab: 'features' });
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
  updateSketch(null, { selection: [], hover: null, commandTab: 'features' });
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
    case 'app.settings':
      openDialog('settings');
      break;
    case 'app.about':
      openDialog('about');
      break;
  }
}
