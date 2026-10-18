import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const repoRoot = path.resolve(__dirname, '../..');

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userData: string;
  outputDir: string;
}

export interface LaunchOptions {
  userData?: string;
  env?: Record<string, string>;
  width?: number;
  height?: number;
}

/** Starts the built app (out/) in test mode with an isolated profile and output folder. */
export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  const userData = options.userData ?? (await mkdtemp(path.join(tmpdir(), 'parawerk-profile-')));
  const outputDir = await mkdtemp(path.join(tmpdir(), 'parawerk-output-'));
  // PARAWERK_E2E_EXECUTABLE runs the tests against a packaged app instead of out/.
  const executable = process.env.PARAWERK_E2E_EXECUTABLE;
  const app = await electron.launch({
    ...(executable ? { executablePath: executable, args: [] } : { args: [repoRoot] }),
    cwd: repoRoot,
    env: {
      ...process.env,
      PARAWERK_E2E: '1',
      PARAWERK_USER_DATA: userData,
      PARAWERK_E2E_OUTPUT_DIR: outputDir,
      PARAWERK_TEST_LOCALE: 'en',
      ...options.env,
    } as Record<string, string>,
  });
  const page = await app.firstWindow();
  // Interval polling instead of requestAnimationFrame, which does not run while a window is hidden.
  await page.waitForFunction(() => '__parawerk' in window, undefined, { timeout: 60_000, polling: 250 });
  if (options.width && options.height) {
    await app.evaluate(({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setContentSize(size.width, size.height);
      window?.center();
    }, { width: options.width, height: options.height });
  }
  await waitForKernel(page);
  return { app, page, userData, outputDir };
}

export async function waitForKernel(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const status = document.querySelector('[data-testid="kernel-status"]')?.getAttribute('data-status');
    return status === 'ready';
  }, undefined, { timeout: 90_000, polling: 250 });
}

/** Waits until the kernel has finished all queued rebuilds. */
export async function idle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const hooks = (window as unknown as { __parawerk: { whenIdle(): Promise<void> } }).__parawerk;
    await hooks.whenIdle();
  });
}
