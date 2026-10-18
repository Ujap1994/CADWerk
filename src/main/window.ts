import { app, BrowserWindow, dialog, nativeTheme, screen, type Rectangle } from 'electron';
import path from 'node:path';
import { APP_NAME } from '../shared/app-info.ts';
import { translate, type Language } from '../shared/i18n.ts';
import type { DocumentState } from '../shared/ipc.ts';
import type { ThemeSetting } from '../shared/settings.ts';
import { JsonFile } from './settings-store.ts';

interface WindowState {
  bounds?: Rectangle;
  maximized?: boolean;
}

export interface MainWindowOptions {
  url: string;
  preload: string;
  icon: string | undefined;
  theme: ThemeSetting;
  testMode: boolean;
  language: () => Language;
}

export interface MainWindow {
  window: BrowserWindow;
  setDocumentState(state: DocumentState): void;
}

const DEFAULT_SIZE = { width: 1440, height: 900 };

function isVisibleOnSomeDisplay(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapX = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
    const overlapY = Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y);
    return overlapX > 100 && overlapY > 100;
  });
}

function backgroundColor(theme: ThemeSetting): string {
  const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
  return dark ? '#12161c' : '#f3f5f8';
}

export function createMainWindow(options: MainWindowOptions): MainWindow {
  const stateFile = new JsonFile<WindowState>(path.join(app.getPath('userData'), 'window-state.json'));
  const saved = (options.testMode ? undefined : stateFile.read()) as WindowState | undefined;
  const bounds = saved?.bounds && isVisibleOnSomeDisplay(saved.bounds) ? saved.bounds : undefined;

  const window = new BrowserWindow({
    ...(bounds ?? DEFAULT_SIZE),
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: APP_NAME,
    backgroundColor: backgroundColor(options.theme),
    ...(options.icon ? { icon: options.icon } : {}),
    webPreferences: {
      preload: options.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: !app.isPackaged || options.testMode,
    },
  });
  if (saved?.maximized && !options.testMode) window.maximize();

  let documentState: DocumentState = { title: APP_NAME, dirty: false };

  window.once('ready-to-show', () => window.show());
  // Never leave an invisible app behind if the first paint is delayed (e.g. an occluded window on Windows).
  const showFallback = setTimeout(() => {
    if (!window.isDestroyed() && !window.isVisible()) window.show();
  }, 3000);
  window.once('show', () => clearTimeout(showFallback));
  window.once('closed', () => clearTimeout(showFallback));

  window.on('close', (event) => {
    if (!options.testMode) stateFile.write({ bounds: window.getNormalBounds(), maximized: window.isMaximized() });
    if (!documentState.dirty || options.testMode) return;
    const language = options.language();
    const choice = dialog.showMessageBoxSync(window, {
      type: 'question',
      buttons: [translate(language, 'dialogs.quit'), translate(language, 'dialogs.cancel')],
      defaultId: 1,
      cancelId: 1,
      message: translate(language, 'dialogs.closeMessage'),
      detail: translate(language, 'dialogs.discardDetail', { name: documentState.title }),
    });
    if (choice !== 0) event.preventDefault();
  });

  void window.loadURL(options.url);

  return {
    window,
    setDocumentState(state) {
      documentState = state;
      window.setDocumentEdited(state.dirty);
    },
  };
}
