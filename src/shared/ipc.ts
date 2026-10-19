import type { Settings } from './settings.ts';

/** IPC channel names between the main process and the preload bridge. */
export const IpcChannel = {
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  getAppInfo: 'app:info',
  saveFile: 'file:save',
  openFile: 'file:open',
  confirm: 'dialog:confirm',
  setDocumentState: 'document:state',
  openExternal: 'app:open-external',
  menuCommand: 'menu:command',
  openPath: 'file:open-path',
  rendererReady: 'app:renderer-ready',
  selfTestResult: 'app:self-test-result',
} as const;

export type MenuCommand =
  | 'file.new'
  | 'file.open'
  | 'file.save'
  | 'file.saveAs'
  | 'file.exportStep'
  | 'file.exportStl'
  | 'edit.undo'
  | 'edit.redo'
  | 'view.zoomToFit'
  | 'view.front'
  | 'view.back'
  | 'view.left'
  | 'view.right'
  | 'view.top'
  | 'view.bottom'
  | 'view.isometric'
  | 'view.toggleProjection'
  | 'view.toggleFrameStats'
  | 'view.toggleSketchRelations'
  | 'app.settings'
  | 'app.about';

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface SaveFileRequest {
  title: string;
  defaultName: string;
  filters: FileFilter[];
  data: Uint8Array;
  /** Writes to this path without a dialog (plain "Save" of an already saved document). */
  path?: string;
}

export type SaveFileResult =
  | { status: 'saved'; path: string }
  | { status: 'canceled' }
  | { status: 'error'; message: string };

export interface OpenFileRequest {
  title: string;
  filters: FileFilter[];
}

export type OpenFileResult =
  | { status: 'opened'; path: string; data: Uint8Array }
  | { status: 'canceled' }
  | { status: 'error'; message: string };

export interface ConfirmRequest {
  message: string;
  detail?: string;
  confirmLabel: string;
  cancelLabel: string;
}

export interface DocumentState {
  title: string;
  dirty: boolean;
}

export interface AppInfo {
  version: string;
  systemLocale: string;
  platform: string;
  arch: string;
  electron: string;
  chrome: string;
  /** True when started by the end-to-end test or benchmark harness. */
  testMode: boolean;
  /** True when started with --self-test (installation check, see docs/user-guide/troubleshooting.md). */
  selfTest: boolean;
}

export interface SelfTestCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SelfTestResult {
  ok: boolean;
  durationMs: number;
  checks: SelfTestCheck[];
}

/** API exposed to the renderer as `window.parawerk`. */
export interface ParaWerkApi {
  getAppInfo(): Promise<AppInfo>;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  saveFile(request: SaveFileRequest): Promise<SaveFileResult>;
  openFile(request: OpenFileRequest): Promise<OpenFileResult>;
  confirm(request: ConfirmRequest): Promise<boolean>;
  setDocumentState(state: DocumentState): void;
  openExternal(url: string): Promise<void>;
  /** Subscribes to menu commands; returns an unsubscribe function. */
  onMenuCommand(listener: (command: MenuCommand) => void): () => void;
  /** Subscribes to files opened from the OS (double-click, command line). */
  onOpenPath(listener: (file: { path: string; data: Uint8Array }) => void): () => void;
  /** Tells the main process that the UI is ready to receive files and commands. */
  rendererReady(): void;
  /** Reports the result of --self-test; the app then quits with a matching exit code. */
  reportSelfTest(result: SelfTestResult): void;
}
