import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { Language } from '../../../shared/i18n.ts';
import type { AppInfo } from '../../../shared/ipc.ts';
import type { Feature } from '../../../shared/model/feature.ts';
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/settings.ts';
import type { FeatureResult, MassProperties, MeshPayload } from '../../../kernel/protocol.ts';
import { emptyHistory, type ActiveEdit, type History } from './document.ts';

export interface Pick {
  kind: 'face' | 'edge';
  index: number;
}

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
  selection: Pick[];
  hover: Pick | null;

  kernelStatus: KernelStatus;
  rebuild: RebuildState | null;
  display: DisplayMeshes;

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
  selection: [],
  hover: null,
  kernelStatus: 'loading',
  rebuild: null,
  display: { body: null, preview: null, pickable: true },
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
