import { app, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  IpcChannel,
  type AppInfo,
  type ConfirmRequest,
  type DocumentState,
  type OpenFileRequest,
  type OpenFileResult,
  type SaveFileRequest,
  type SaveFileResult,
} from '../shared/ipc.ts';
import type { Settings } from '../shared/settings.ts';
import type { MainWindow } from './window.ts';
import type { SettingsStore } from './settings-store.ts';

/** Largest file the app opens (part files are small; this guards against mistakes). */
const MAX_OPEN_BYTES = 512 * 1024 * 1024;

export interface IpcContext {
  main: MainWindow;
  settings: SettingsStore;
  testMode: boolean;
  selfTest: boolean;
  isTrustedUrl(url: string): boolean;
  systemLocale: string;
  onSettingsChanged(settings: Settings): void;
}

export function registerIpc(context: IpcContext): void {
  const { main, settings, testMode } = context;
  /** Paths the user picked in a dialog (or opened); "Save" may only write to these. */
  const grantedPaths = new Set<string>();

  const trusted = (event: IpcMainInvokeEvent | Electron.IpcMainEvent) => {
    const url = event.senderFrame?.url ?? '';
    if (!context.isTrustedUrl(url)) throw new Error(`Blocked IPC from untrusted origin: ${url}`);
  };

  ipcMain.handle(IpcChannel.getAppInfo, (event): AppInfo => {
    trusted(event);
    return {
      version: app.getVersion(),
      systemLocale: context.systemLocale,
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      testMode,
      selfTest: context.selfTest,
    };
  });

  ipcMain.handle(IpcChannel.getSettings, (event) => {
    trusted(event);
    return settings.get();
  });

  ipcMain.handle(IpcChannel.setSettings, (event, patch: unknown) => {
    trusted(event);
    const updated = settings.update(patch);
    context.onSettingsChanged(updated);
    return updated;
  });

  ipcMain.handle(IpcChannel.saveFile, async (event, request: SaveFileRequest): Promise<SaveFileResult> => {
    trusted(event);
    try {
      if (!(request.data instanceof Uint8Array)) throw new Error('invalid data');
      let target: string | undefined;
      if (testMode && process.env.PARAWERK_E2E_OUTPUT_DIR) {
        target = path.join(process.env.PARAWERK_E2E_OUTPUT_DIR, path.basename(request.defaultName));
      } else if (request.path && grantedPaths.has(request.path)) {
        target = request.path;
      } else {
        const result = await dialog.showSaveDialog(main.window, {
          title: request.title,
          defaultPath: request.path ?? request.defaultName,
          filters: request.filters,
        });
        if (result.canceled || !result.filePath) return { status: 'canceled' };
        target = result.filePath;
      }
      await writeFile(target, request.data);
      grantedPaths.add(target);
      return { status: 'saved', path: target };
    } catch (error) {
      return { status: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IpcChannel.openFile, async (event, request: OpenFileRequest): Promise<OpenFileResult> => {
    trusted(event);
    try {
      let file: string | undefined;
      if (testMode && process.env.PARAWERK_E2E_OPEN_FILE) {
        file = process.env.PARAWERK_E2E_OPEN_FILE;
      } else {
        const result = await dialog.showOpenDialog(main.window, {
          title: request.title,
          filters: request.filters,
          properties: ['openFile'],
        });
        if (result.canceled || result.filePaths.length === 0) return { status: 'canceled' };
        file = result.filePaths[0];
      }
      if (!file) return { status: 'canceled' };
      return { status: 'opened', path: file, data: await readAllowedFile(file, grantedPaths) };
    } catch (error) {
      return { status: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IpcChannel.confirm, async (event, request: ConfirmRequest) => {
    trusted(event);
    if (testMode || context.selfTest) return process.env.PARAWERK_E2E_CONFIRM !== 'no';
    const result = await dialog.showMessageBox(main.window, {
      type: 'question',
      buttons: [request.confirmLabel, request.cancelLabel],
      defaultId: 1,
      cancelId: 1,
      message: request.message,
      detail: request.detail ?? '',
    });
    return result.response === 0;
  });

  ipcMain.on(IpcChannel.setDocumentState, (event, state: DocumentState) => {
    try {
      trusted(event);
    } catch {
      return;
    }
    if (typeof state?.title === 'string' && typeof state.dirty === 'boolean') main.setDocumentState(state);
  });

  ipcMain.handle(IpcChannel.openExternal, async (event, url: string) => {
    trusted(event);
    if (isAllowedExternalUrl(url)) await shell.openExternal(url);
  });
}

export async function readAllowedFile(file: string, grantedPaths: Set<string>): Promise<Uint8Array> {
  const info = await stat(file);
  if (!info.isFile()) throw new Error('not a file');
  if (info.size > MAX_OPEN_BYTES) throw new Error('file is too large');
  const data = await readFile(file);
  grantedPaths.add(file);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

export function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === 'github.com' || parsed.hostname.endsWith('.github.com'));
  } catch {
    return false;
  }
}
