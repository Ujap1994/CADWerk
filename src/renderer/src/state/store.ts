import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { Language } from '../../../shared/i18n.ts';
import type { AppInfo } from '../../../shared/ipc.ts';
import type { Feature } from '../../../shared/model/feature.ts';
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/settings.ts';
import type { FeatureResult, MassProperties, MeshPayload } from '../../../kernel/protocol.ts';
import type { SketchSession } from '../sketch/session.ts';
import type { SketchAnalysis } from './sketch-status.ts';
import type { SketchToolName } from '../sketch/tools.ts';
import { emptyHistory, type ActiveEdit, type History } from './document.ts';

/** A picked body face or edge (topological index), or a standard plane (index into STANDARD_PLANES). */
export interface Pick {
  kind: 'face' | 'edge' | 'plane';
  index: number;
}

export type CommandTab = 'features' | 'sketch';

export type KernelStatus = 'loading' | 'ready' | 'busy' | 'error';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
}

export interface FrameStats {
  fps: number;
  frameMs: number;
}

export interface RebuildState {
  results: FeatureResult[];
  properties: MassProperties | null;
  totalMs: number;
  rebuiltFeatures: number;
}

/** Meshes currently shown: the body (pickable) and, while editing, a translucent preview. */
export interface DisplayMeshes {
  body: MeshPayload | null;
  preview: MeshPayload | null;
  /** Whether faces and edges of the body can be picked. */
  pickable: boolean;
}

export interface AppState {
  appInfo: AppInfo | null;
  settings: Settings;
  language: Language;
  effectiveTheme: 'light' | 'dark';

  history: History;
  /** Feature list as last saved or opened; the document is dirty when it differs. */
  savedFeatures: Feature[];
  filePath: string | null;
  fileName: string | null;
  dirty: boolean;

  activeEdit: ActiveEdit | null;
  /** The sketch command waits for a plane (or planar face) to sketch on. */
  choosingSketchPlane: boolean;
  /** Sketch mode. */
  sketch: SketchSession | null;
  /** Selected entities (and later constraints) of the open sketch, by id. */
  sketchSelection: string[];
  /** Entity of the open sketch under the cursor. */
  sketchHover: string | null;
  /** Definition status of the open sketch (null until the solver has analyzed the current geometry). */
  sketchAnalysis: SketchAnalysis | null;
  /** Definition status of every sketch in the document, by feature id. */
  sketchStatuses: Readonly<Record<string, SketchAnalysis['status']>>;
  /** Active drawing tool in sketch mode; null selects and drags. */
  sketchTool: SketchToolName | null;
  /** Last used variant of the tools with variants, offered first in the command bar. */
  sketchToolVariants: {
    rectangle: 'cornerRectangle' | 'centerRectangle';
    circle: 'circle' | 'threePointCircle';
    arc: 'centerArc' | 'threePointArc' | 'tangentArc';
    corner: 'sketchFillet' | 'sketchChamfer';
  };
  /** Number of sides the polygon tool draws. */
  polygonSides: number;
  /** Radius of sketch fillets and distance of sketch chamfers (mm). */
  filletRadius: number;
  chamferDistance: number;
  selection: Pick[];
  hover: Pick | null;

  kernelStatus: KernelStatus;
  rebuild: RebuildState | null;
  display: DisplayMeshes;

  commandTab: CommandTab;
  dialogs: { settings: boolean; about: boolean };
  toasts: Toast[];
  frameStats: FrameStats | null;
}

export const initialState: AppState = {
  appInfo: null,
  settings: DEFAULT_SETTINGS,
  language: 'en',
  effectiveTheme: 'light',
  history: emptyHistory(),
  savedFeatures: [],
  filePath: null,
  fileName: null,
  dirty: false,
  activeEdit: null,
  choosingSketchPlane: false,
  sketch: null,
  sketchSelection: [],
  sketchHover: null,
  sketchAnalysis: null,
  sketchStatuses: {},
  sketchTool: null,
  sketchToolVariants: { rectangle: 'cornerRectangle', circle: 'circle', arc: 'centerArc', corner: 'sketchFillet' },
  polygonSides: 6,
  filletRadius: 5,
  chamferDistance: 3,
  selection: [],
  hover: null,
  kernelStatus: 'loading',
  rebuild: null,
  display: { body: null, preview: null, pickable: true },
  commandTab: 'features',
  dialogs: { settings: false, about: false },
  toasts: [],
  frameStats: null,
};

export const store = createStore<AppState>()(() => initialState);

export function useAppState<T>(selector: (state: AppState) => T): T {
  return useStore(store, selector);
}

export const getState = store.getState;
export const setState = store.setState;

export function features(): Feature[] {
  return store.getState().history.features;
}

/** Replaces the document history and keeps the dirty flag in sync. */
export function setHistory(history: History, extra: Partial<AppState> = {}): void {
  setState((state) => {
    const savedFeatures = extra.savedFeatures ?? state.savedFeatures;
    return { ...extra, history, dirty: history.features !== savedFeatures };
  });
}

let toastId = 0;

export function showToast(kind: Toast['kind'], message: string, durationMs = kind === 'error' ? 8000 : 3500): void {
  toastId += 1;
  const toast: Toast = { id: toastId, kind, message };
  setState((state) => ({ toasts: [...state.toasts.slice(-4), toast] }));
  setTimeout(() => dismissToast(toast.id), durationMs);
}

export function dismissToast(id: number): void {
  setState((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
}
