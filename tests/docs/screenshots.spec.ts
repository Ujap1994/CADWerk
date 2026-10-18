import { test, type Page } from '@playwright/test';
import path from 'node:path';
import { idle, launchApp, repoRoot } from '../e2e/harness.ts';

/**
 * Generates the screenshots used in README.md and docs/user-guide.
 * Run with `npm run docs:screenshots` after `npm run build`.
 */
const out = (name: string) => path.join(repoRoot, 'docs/images/screenshots', name);

async function buildDemoPart(page: Page): Promise<void> {
  await page.evaluate(() => {
    const hooks = (window as unknown as { __parawerk: { setState(s: unknown): void; getState(): { history: unknown } } }).__parawerk;
    const features = [
      { id: 'base', type: 'box', operation: 'add', width: 120, depth: 80, height: 20, position: [0, 0, 0] },
      { id: 'boss', type: 'cylinder', operation: 'add', radius: 22, height: 35, axis: 'z', position: [20, 0, 20] },
      { id: 'bore', type: 'cylinder', operation: 'cut', radius: 12, height: 80, axis: 'z', position: [20, 0, -10] },
      { id: 'slot', type: 'box', operation: 'cut', width: 30, depth: 14, height: 30, position: [-38, 0, -5] },
      { id: 'hole1', type: 'cylinder', operation: 'cut', radius: 4.5, height: 40, axis: 'z', position: [-45, 28, -10] },
      { id: 'hole2', type: 'cylinder', operation: 'cut', radius: 4.5, height: 40, axis: 'z', position: [-45, -28, -10] },
    ];
    const history = { features, past: [], future: [] };
    hooks.setState({ history, savedFeatures: features, dirty: false, fileName: 'Bearing block' });
  });
  await idle(page);
}

test('README and user guide screenshots', async () => {
  const { app, page } = await launchApp({ width: 1440, height: 900 });
  await buildDemoPart(page);
  await page.evaluate(() => (window as unknown as { __parawerk: { viewport: { zoomToFit(): void } } }).__parawerk.viewport.zoomToFit());
  await page.waitForTimeout(600);
  await page.screenshot({ path: out('main-window.png') });

  // Fillet with preview: pick the three vertical edges of the base plate that are visible in the isometric view.
  await page.click('[data-command="fillet"]');
  await idle(page);
  const canvas = await page.locator('.viewport-canvas').boundingBox();
  for (const point of [[60, -40, 10], [60, 40, 10], [-60, -40, 10]] as const) {
    const screen = await page.evaluate(
      ([x, y, z]) => (window as unknown as { __parawerk: { viewport: { project(x: number, y: number, z: number): { x: number; y: number } } } }).__parawerk.viewport.project(x, y, z),
      point,
    );
    if (canvas) await page.mouse.click(canvas.x + screen.x, canvas.y + screen.y);
    await idle(page);
  }
  await page.locator('[data-testid="fillet-radius"]').fill('8');
  await idle(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('fillet-preview.png') });
  await page.click('[data-testid="panel-ok"]');
  await idle(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('filleted-part.png') });

  await page.click('[data-command="settings"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('settings-dialog.png') });
  await page.locator('[data-testid="settings-dialog"] [name="theme"][data-value="dark"]').click();
  await page.locator('[data-testid="settings-dialog"] [name="language"][data-value="de"]').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.screenshot({ path: out('dark-theme-german.png') });
  await app.close();
});
