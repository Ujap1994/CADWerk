import { app, ipcMain, Menu, nativeImage, session, shell } from 'electron';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { APP_ID, APP_NAME, APP_ORIGIN, PART_FILE_EXTENSION } from '../shared/app-info.ts';
import { resolveLanguage } from '../shared/i18n.ts';
import { IpcChannel, type MenuCommand, type SelfTestResult } from '../shared/ipc.ts';
import type { Settings } from '../shared/settings.ts';
import { isAllowedExternalUrl, registerIpc } from './ipc.ts';
import { buildMenu } from './menu.ts';
import { registerAppProtocol, registerAppScheme } from './protocol.ts';
import { SettingsStore } from './settings-store.ts';
import { createMainWindow, type MainWindow } from './window.ts';

const testMode = process.env.PARAWERK_E2E === '1';
/** `ParaWerk --self-test` checks an installation without user interaction and exits with 0 or 1. */
const selfTest = process.argv.includes('--self-test');
const SELF_TEST_TIMEOUT_MS = 180_000;
const benchMode = process.env.PARAWERK_BENCH === '1';
const devServerUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;

if (process.env.PARAWERK_USER_DATA) app.setPath('userData', process.env.PARAWERK_USER_DATA);
// The self-test uses a throw-away profile so it never touches the user's settings.
if (selfTest) app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'parawerk-self-test-')));
app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

// Keep WebGL working without a usable GPU (virtual machines, CI, blocklisted drivers).
// The renderer only runs ParaWerk's own code, so the software rasterizer is safe here.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
if (benchMode) {
  app.commandLine.appendSwitch('disable-gpu-vsync');
  app.commandLine.appendSwitch('disable-frame-rate-limit');
}

registerAppScheme();

function isTrustedUrl(url: string): boolean {
  return url.startsWith(`${APP_ORIGIN}/`) || (devServerUrl !== undefined && url.startsWith(devServerUrl));
}

function partFileFromArgs(argv: readonly string[]): string | undefined {
  return argv.slice(1).find((arg) => !arg.startsWith('-') && arg.toLowerCase().endsWith(`.${PART_FILE_EXTENSION}`));
}

function iconPath(): string | undefined {
  if (process.platform === 'darwin') return undefined;
  return app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(app.getAppPath(), 'build/icons/512x512.png');
}

function finishSelfTest(result: SelfTestResult): void {
  const text = JSON.stringify(result, null, 2);
  console.log(text);
  if (process.env.PARAWERK_SELF_TEST_OUTPUT) writeFileSync(process.env.PARAWERK_SELF_TEST_OUTPUT, text);
  app.exit(result.ok ? 0 : 1);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let main: MainWindow | undefined;
  let rendererReady = false;
  let pendingFile: string | undefined = partFileFromArgs(process.argv);

  const sendOpenPath = async (file: string) => {
    if (!main || !rendererReady) {
      pendingFile = file;
      return;
    }
    try {
      const data = await readFile(file);
      main.window.webContents.send(IpcChannel.openPath, { path: file, data: new Uint8Array(data) });
    } catch (error) {
      console.error(`Could not open ${file}`, error);
    }
  };

  app.on('second-instance', (_event, argv) => {
    if (!main) return;
    if (main.window.isMinimized()) main.window.restore();
    main.window.focus();
    const file = partFileFromArgs(argv);
    if (file) void sendOpenPath(file);
  });

  app.on('open-file', (event, file) => {
    event.preventDefault();
    void sendOpenPath(file);
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedExternalUrl(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedUrl(url)) event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  // Closing the window ends the application on every platform.
  app.on('window-all-closed', () => app.quit());

  void app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);

    const rendererRoot = path.join(__dirname, '../renderer');
    if (!devServerUrl) registerAppProtocol(rendererRoot);

    const settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
    // Tests pin the locale so they behave the same on every machine.
    const testLocale = testMode ? process.env.PARAWERK_TEST_LOCALE : undefined;
    const systemLocale = testLocale || app.getPreferredSystemLanguages()[0] || app.getLocale();
    const language = () => resolveLanguage(settings.get().language, systemLocale);

    const icon = iconPath();
    if (process.platform === 'darwin' && !app.isPackaged) {
      app.dock?.setIcon(nativeImage.createFromPath(path.join(app.getAppPath(), 'build/icons/512x512.png')));
    }

    main = createMainWindow({
      url: devServerUrl ?? `${APP_ORIGIN}/index.html`,
      preload: path.join(__dirname, '../preload/index.js'),
      icon,
      theme: settings.get().theme,
      testMode: testMode || selfTest,
      language,
    });
    const window = main.window;

    const send = (command: MenuCommand) => window.webContents.send(IpcChannel.menuCommand, command);
    const applyMenu = (current: Settings) => {
      Menu.setApplicationMenu(
        buildMenu({ language: language(), settings: current, developerTools: !app.isPackaged || testMode, send }),
      );
    };
    applyMenu(settings.get());

    registerIpc({ main, settings, testMode, selfTest, isTrustedUrl, systemLocale, onSettingsChanged: applyMenu });

    if (selfTest) {
      ipcMain.on(IpcChannel.selfTestResult, (event, result: SelfTestResult) => {
        if (isTrustedUrl(event.senderFrame?.url ?? '')) finishSelfTest(result);
      });
      setTimeout(() => {
        finishSelfTest({ ok: false, durationMs: SELF_TEST_TIMEOUT_MS, checks: [{ name: 'timeout', ok: false, detail: 'no result from the renderer' }] });
      }, SELF_TEST_TIMEOUT_MS);
    }

    ipcMain.on(IpcChannel.rendererReady, (event) => {
      if (!isTrustedUrl(event.senderFrame?.url ?? '')) return;
      rendererReady = true;
      if (pendingFile) {
        const file = pendingFile;
        pendingFile = undefined;
        void sendOpenPath(file);
      }
    });
    // A reload starts a fresh renderer that has to announce itself again.
    window.webContents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) rendererReady = false;
    });
  });
}
