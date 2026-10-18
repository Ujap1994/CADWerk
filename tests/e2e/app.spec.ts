import { expect, test, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { idle, launchApp, repoRoot, type LaunchedApp } from './harness.ts';

interface HookState {
  history: { features: { type: string; id: string; suppressed?: boolean }[] };
  rebuild: { properties: { volume: number } | null; results: { status: string; error?: { code: string } }[] } | null;
  dirty: boolean;
  language: string;
  fileName: string | null;
}

async function state(page: Page): Promise<HookState> {
  return page.evaluate(() => (window as unknown as { __parawerk: { getState(): unknown } }).__parawerk.getState() as HookState);
}

async function volume(page: Page): Promise<number> {
  await idle(page);
  return (await state(page)).rebuild?.properties?.volume ?? Number.NaN;
}

/** Clicks the screen position of a world point (e.g. the middle of an edge). */
async function clickWorldPoint(page: Page, point: [number, number, number]): Promise<void> {
  const canvas = await page.locator('.viewport-canvas').boundingBox();
  if (!canvas) throw new Error('viewport not visible');
  const screen = await page.evaluate(
    ([x, y, z]) => (window as unknown as { __parawerk: { viewport: { project(x: number, y: number, z: number): { x: number; y: number } } } }).__parawerk.viewport.project(x, y, z),
    point,
  );
  await page.mouse.move(canvas.x + screen.x, canvas.y + screen.y);
  await page.mouse.click(canvas.x + screen.x, canvas.y + screen.y);
  await idle(page);
}

async function createBox(page: Page): Promise<void> {
  await page.click('[data-command="box"]');
  await page.click('[data-testid="panel-ok"]');
  await idle(page);
}

let launched: LaunchedApp | undefined;

test.afterEach(async () => {
  await launched?.app.close();
  launched = undefined;
});

test('starts with one window, the kernel ready and the system language', async () => {
  launched = await launchApp();
  const { app, page } = launched;
  expect(app.windows()).toHaveLength(1);
  await expect(page).toHaveTitle(/ParaWerk/);
  await expect(page.locator('[data-testid="kernel-status"]')).toHaveAttribute('data-status', 'ready');
  const security = await page.evaluate(() => ({
    node: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    isolated: window.crossOriginIsolated,
  }));
  expect(security).toEqual({ node: 'undefined', process: 'undefined', isolated: true });
});

test('allows only a single instance', async () => {
  launched = await launchApp();
  // In Node, the electron package resolves to the path of the Electron binary.
  const electronBinary = require('electron') as string;
  const second = spawn(electronBinary, [repoRoot], {
    env: { ...process.env, PARAWERK_E2E: '1', PARAWERK_USER_DATA: launched.userData },
    stdio: 'ignore',
  });
  const exitCode = await new Promise<number | null>((resolve) => second.on('exit', resolve));
  expect(exitCode).toBe(0);
  expect(launched.app.windows()).toHaveLength(1);
});

test('creates a box, rounds edges picked in the 3D view and exports STEP and STL', async () => {
  launched = await launchApp({ width: 1440, height: 900 });
  const { page, outputDir } = launched;

  await createBox(page);
  expect(await volume(page)).toBeCloseTo(240_000, 3);

  await page.click('[data-command="fillet"]');
  await idle(page);
  // Middle of the top front edge of the 100 × 60 × 40 box.
  await clickWorldPoint(page, [0, -30, 40]);
  await expect(page.locator('[data-testid="edge-count"]')).toContainText('1');
  await page.locator('[data-testid="fillet-radius"]').fill('5');
  await page.click('[data-testid="panel-ok"]');

  // One rounded 100 mm edge removes r²(1 - π/4) · 100.
  expect(await volume(page)).toBeCloseTo(240_000 - 25 * (1 - Math.PI / 4) * 100, 1);
  expect((await state(page)).history.features.map((f) => f.type)).toEqual(['box', 'fillet']);

  await page.click('[data-command="export-step"]');
  await expect(page.locator('[data-testid="toast-success"]').last()).toBeVisible();
  const step = await readFile(path.join(outputDir, `${await page.evaluate(() => document.title.split(' – ')[0]?.replace(' •', ''))}.step`));
  expect(step.subarray(0, 13).toString()).toBe('ISO-10303-21;');

  await page.click('[data-command="export-stl"]');
  await expect(page.locator('[data-testid="toast-success"]').last()).toBeVisible();
});

test('saves and reopens a part file', async () => {
  launched = await launchApp();
  const { page, outputDir } = launched;
  await createBox(page);
  await page.click('[data-command="cylinder"]');
  await page.getByRole('radio', { name: /Remove material|Material entfernen/ }).click();
  await page.click('[data-testid="panel-ok"]');
  const expected = await volume(page);
  expect((await state(page)).dirty).toBe(true);

  await page.click('[data-command="save"]');
  await expect.poll(async () => (await state(page)).dirty).toBe(false);
  const fileName = (await state(page)).fileName;
  expect(fileName).toBeTruthy();

  await page.click('[data-command="new"]');
  await expect.poll(async () => (await state(page)).history.features.length).toBe(0);

  const file = path.join(outputDir, `${fileName}.pwpart`);
  await page.evaluate(async (bytes) => {
    const hooks = (window as unknown as { __parawerk: { commands: { loadDocument(path: string, data: Uint8Array): void } } }).__parawerk;
    hooks.commands.loadDocument('reopened.pwpart', new Uint8Array(bytes));
  }, [...(await readFile(file))]);
  await expect.poll(async () => (await state(page)).history.features.length).toBe(2);
  expect(await volume(page)).toBeCloseTo(expected, 6);
});

test('undo, redo and suppress', async () => {
  launched = await launchApp();
  const { page } = launched;
  await createBox(page);
  await page.click('[data-command="cylinder"]');
  await page.click('[data-testid="panel-ok"]');
  const both = await volume(page);

  await page.click('[data-command="undo"]');
  expect(await volume(page)).toBeCloseTo(240_000, 3);
  await page.click('[data-command="redo"]');
  expect(await volume(page)).toBeCloseTo(both, 3);

  const cylinderId = (await state(page)).history.features[1]?.id;
  await page.locator(`[data-feature-id="${cylinderId}"]`).hover();
  await page.locator(`[data-feature-id="${cylinderId}"] .tree-actions button`).nth(1).click();
  expect(await volume(page)).toBeCloseTo(240_000, 3);
  await expect(page.locator(`[data-feature-id="${cylinderId}"]`)).toHaveClass(/is-suppressed/);
});

test('shows a feature error instead of failing', async () => {
  launched = await launchApp();
  const { page } = launched;
  await createBox(page);
  await page.click('[data-command="fillet"]');
  await idle(page);
  await clickWorldPoint(page, [0, -30, 40]);
  await page.locator('[data-testid="fillet-radius"]').fill('80');
  await idle(page);
  await expect(page.locator('.panel-error')).toBeVisible();
  await page.click('[data-testid="panel-cancel"]');
  await expect(page.locator('.feature-tree')).toBeVisible();
  expect((await state(page)).history.features).toHaveLength(1);
});

test('switches the language at runtime and remembers it', async () => {
  launched = await launchApp();
  const { page, userData } = launched;
  await page.click('[data-command="settings"]');
  await page.locator('[data-testid="settings-dialog"] [name="language"][data-value="de"]').click();
  await expect(page.locator('[data-command="box"] .command-label')).toHaveText('Quader');
  await page.locator('[data-testid="settings-dialog"] [name="language"][data-value="en"]').click();
  await expect(page.locator('[data-command="box"] .command-label')).toHaveText('Box');
  await page.locator('[data-testid="settings-dialog"] [name="language"][data-value="de"]').click();
  await launched.app.close();

  launched = await launchApp({ userData });
  await expect(launched.page.locator('[data-command="box"] .command-label')).toHaveText('Quader');
  expect((await state(launched.page)).language).toBe('de');
});
