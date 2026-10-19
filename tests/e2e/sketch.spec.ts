import { expect, test, type Page } from '@playwright/test';
import { readdir } from 'node:fs/promises';
import { idle, launchApp, type LaunchedApp } from './harness.ts';

interface SketchState {
  history: { features: { id: string; type: string; plane?: { kind: string; plane?: string }; sketch?: { entities: unknown[] } }[]; past: unknown[] };
  choosingSketchPlane: boolean;
  sketch: { mode: string; index: number; draft: { plane: { plane?: string }; sketch: { entities: unknown[] } }; past: unknown[] } | null;
  rebuild: { results: unknown[] } | null;
  dirty: boolean;
  commandTab: string;
}

interface Hooks {
  getState(): SketchState;
  setState(state: unknown): void;
  commands: { recordSketchChange(sketch: unknown): void };
  viewport: { project(x: number, y: number, z: number): { x: number; y: number } };
}

async function state(page: Page): Promise<SketchState> {
  return page.evaluate(() => (window as unknown as { __parawerk: Hooks }).__parawerk.getState());
}

async function project(page: Page, point: [number, number, number]): Promise<{ x: number; y: number }> {
  return page.evaluate(([x, y, z]) => (window as unknown as { __parawerk: Hooks }).__parawerk.viewport.project(x, y, z), point);
}

/** Draws a point "with a tool": one recorded sketch operation. */
async function drawPoint(page: Page, id: string, x: number, y: number): Promise<void> {
  await page.evaluate(
    ({ id, x, y }) => {
      const parawerk = (window as unknown as { __parawerk: Hooks }).__parawerk;
      const sketch = parawerk.getState().sketch?.draft.sketch as { entities: unknown[]; constraints: unknown[] };
      parawerk.commands.recordSketchChange({ ...sketch, entities: [...sketch.entities, { id, type: 'point', x, y }] });
    },
    { id, x, y },
  );
}

/** Waits until the view looks straight at the sketch plane: sketch x to the right, sketch y up. */
async function expectNormalView(page: Page, xDir: [number, number, number], yDir: [number, number, number]): Promise<void> {
  await expect
    .poll(async () => {
      const origin = await project(page, [0, 0, 0]);
      const x = await project(page, xDir.map((v) => v * 10) as [number, number, number]);
      const y = await project(page, yDir.map((v) => v * 10) as [number, number, number]);
      return [Math.sign(Math.round(x.x - origin.x)), Math.round(x.y - origin.y), Math.round(y.x - origin.x), Math.sign(Math.round(y.y - origin.y))];
    })
    .toEqual([1, 0, 0, -1]);
}

let launched: LaunchedApp | undefined;

test.afterEach(async () => {
  await launched?.app.close();
  launched = undefined;
});

test('the sketch command asks for a plane and opens sketch mode normal to it', async () => {
  launched = await launchApp();
  const { page } = launched;
  await page.click('[data-command="sketch"]');
  await expect(page.locator('.sketch-panel')).toContainText('Choose a plane');
  expect((await state(page)).choosingSketchPlane).toBe(true);
  expect((await state(page)).commandTab).toBe('sketch');

  // Escape cancels the plane choice.
  await page.keyboard.press('Escape');
  expect((await state(page)).choosingSketchPlane).toBe(false);

  await page.click('[data-command="sketch"]');
  await page.click('.plane-choice[data-plane="front"]');
  await expect(page.locator('[data-testid="sketch-title"]')).toHaveText('New Sketch1');
  await expect(page.locator('[data-testid="sketch-plane"]')).toHaveText('Front plane');
  expect((await state(page)).sketch?.draft.plane.plane).toBe('front');
  // Front plane: sketch x is model X, sketch y is model Z.
  await expectNormalView(page, [1, 0, 0], [0, 0, 1]);
  await expect(page.locator('[data-command="exit-sketch"]')).toBeVisible();
  await expect(page.locator('[data-command="box"]')).toHaveCount(0);
  await page.click('[data-tab="features"]');
  await expect(page.locator('[data-command="box"]')).toBeDisabled();
});

test('a plane clicked in the view or in the feature tree becomes the sketch plane', async () => {
  launched = await launchApp();
  const { page } = launched;
  await page.click('[data-command="sketch"]');
  await idle(page);
  // A point on the Top plane that no other plane hides in the isometric view.
  const canvas = await page.locator('.viewport-canvas').boundingBox();
  if (!canvas) throw new Error('viewport not visible');
  const screen = await project(page, [20, 30, 0]);
  await page.mouse.move(canvas.x + screen.x, canvas.y + screen.y);
  await expect(page.locator('[data-testid="pick-info"]')).toHaveText('Top plane');
  await page.mouse.click(canvas.x + screen.x, canvas.y + screen.y);
  await expect(page.locator('[data-testid="sketch-plane"]')).toHaveText('Top plane');
  await expectNormalView(page, [1, 0, 0], [0, 1, 0]);
  await page.click('[data-testid="sketch-ok"]');

  // Select a plane first, then start the sketch.
  await page.click('.tree-item[data-plane="right"]');
  await page.click('[data-command="sketch"]');
  await expect(page.locator('[data-testid="sketch-plane"]')).toHaveText('Right plane');
  await expectNormalView(page, [0, 1, 0], [0, 0, 1]);
});

test('a planar face of the part becomes the sketch plane, curved faces do not', async () => {
  launched = await launchApp();
  const { page } = launched;
  await page.evaluate(() => {
    const features = [
      { id: 'b', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] },
      { id: 'c', type: 'cylinder', operation: 'add', radius: 10, height: 30, axis: 'z', position: [30, 0, 40] },
    ];
    (window as unknown as { __parawerk: Hooks }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features, dirty: false });
  });
  await idle(page);
  await page.click('[data-command="sketch"]');
  const canvas = await page.locator('.viewport-canvas').boundingBox();
  if (!canvas) throw new Error('viewport not visible');

  // The side of the cylinder is not planar: hovering it picks nothing.
  const side = await project(page, [30, -10, 55]);
  await page.mouse.move(canvas.x + side.x, canvas.y + side.y);
  await page.waitForTimeout(150);
  await expect(page.locator('[data-testid="pick-info"]')).toHaveText('');

  // The top face of the box, beside the cylinder and outside all standard planes.
  const top = await project(page, [-35, -20, 40]);
  await page.mouse.move(canvas.x + top.x, canvas.y + top.y);
  await expect(page.locator('[data-testid="pick-info"]')).toContainText('Plane');
  await page.mouse.click(canvas.x + top.x, canvas.y + top.y);
  await expect(page.locator('[data-testid="sketch-plane"]')).toHaveText(/^Face \d+$/);
  const plane = (await state(page)).sketch?.draft.plane as unknown as { kind: string; frame: { origin: number[]; xDir: number[]; yDir: number[]; normal: number[] } };
  expect(plane.kind).toBe('face');
  expect(plane.frame).toEqual({ origin: [0, 0, 40], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] });
  await expectNormalView(page, [1, 0, 0], [0, 1, 0]);
  await drawPoint(page, 'p', 0, 0);
  await page.click('[data-testid="sketch-ok"]');

  // Select a face first, then start the sketch: the front face of the box.
  await page.evaluate(() => (window as unknown as { __parawerk: { commands: { setView(view: string): void } } }).__parawerk.commands.setView('isometric'));
  await page.waitForTimeout(500);
  const front = await project(page, [-30, -30, 10]);
  await page.mouse.click(canvas.x + front.x, canvas.y + front.y);
  await page.click('[data-command="sketch"]');
  const frontPlane = (await state(page)).sketch?.draft.plane as unknown as { frame: { origin: number[]; normal: number[] } };
  expect(frontPlane.frame.origin).toEqual([0, -30, 0]);
  expect(frontPlane.frame.normal).toEqual([0, -1, 0]);
});

test('sketch mode has its own undo and becomes one document step', async () => {
  launched = await launchApp();
  const { page } = launched;
  await page.click('[data-command="box"]');
  await page.click('[data-testid="panel-ok"]');
  await idle(page);

  // An empty new sketch is dropped.
  await page.hover('.tree-item[data-plane="top"]');
  await page.click('.tree-item[data-plane="top"] [aria-label="Sketch on this plane"]');
  await page.click('[data-testid="sketch-ok"]');
  expect((await state(page)).history.features.map((f) => f.type)).toEqual(['box']);

  await page.hover('.tree-item[data-plane="top"]');
  await page.click('.tree-item[data-plane="top"] [aria-label="Sketch on this plane"]');
  await expect(page.locator('[data-command="undo"]')).toBeDisabled();
  await drawPoint(page, 'p1', 10, 10);
  await drawPoint(page, 'p2', 20, 10);
  expect((await state(page)).dirty).toBe(true);
  await expect(page.locator('.sketch-count').first()).toHaveText('2 sketch entities');
  await page.click('[data-command="undo"]');
  await expect(page.locator('.sketch-count').first()).toHaveText('1 sketch entity');
  await page.click('[data-command="redo"]');
  await page.click('[data-command="undo"]');
  await page.click('[data-command="exit-sketch"]');

  const after = await state(page);
  expect(after.sketch).toBeNull();
  expect(after.commandTab).toBe('features');
  expect(after.history.features.map((f) => f.type)).toEqual(['box', 'sketch']);
  expect(after.history.features[1]?.sketch?.entities).toHaveLength(1);
  await expect(page.locator('.tree-item[data-feature-id] .tree-name').last()).toHaveText('Sketch1');

  // The whole sketch session is a single undo step of the document.
  await page.click('[data-command="undo"]');
  expect((await state(page)).history.features.map((f) => f.type)).toEqual(['box']);
});

test('editing a sketch rolls the model back to it and keeps everything on cancel', async () => {
  launched = await launchApp();
  const { page } = launched;
  await page.evaluate(() => {
    const features = [
      { id: 'b', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] },
      { id: 's', type: 'sketch', plane: { kind: 'standard', plane: 'top' }, sketch: { entities: [{ id: 'p', type: 'point', x: 5, y: 5 }], constraints: [] } },
      { id: 'c', type: 'cylinder', operation: 'add', radius: 10, height: 80, axis: 'z', position: [0, 0, 0] },
    ];
    (window as unknown as { __parawerk: Hooks }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features, dirty: false });
  });
  await idle(page);
  expect((await state(page)).rebuild?.results).toHaveLength(3);

  await page.dblclick('.tree-item[data-feature-id="s"]');
  await expect(page.locator('[data-testid="sketch-title"]')).toHaveText('Edit Sketch1');
  await idle(page);
  expect((await state(page)).rebuild?.results).toHaveLength(1);
  await expect(page.locator('.tree-item[data-feature-id="c"]')).toHaveClass(/is-rolled-back/);
  await expect(page.locator('.tree-item[data-feature-id="s"]')).toHaveClass(/is-editing/);
  // Other features cannot be changed while sketching.
  await page.dblclick('.tree-item[data-feature-id="b"]');
  expect((await state(page)).sketch?.index).toBe(1);

  await drawPoint(page, 'q', 1, 2);
  await page.click('[data-testid="sketch-cancel"]');
  const after = await state(page);
  expect(after.sketch).toBeNull();
  expect(after.dirty).toBe(false);
  expect(after.history.features[1]?.sketch?.entities).toHaveLength(1);
  await idle(page);
  expect((await state(page)).rebuild?.results).toHaveLength(3);
});

test('cancelling keeps the sketch open when discarding is declined', async () => {
  launched = await launchApp({ env: { PARAWERK_E2E_CONFIRM: 'no' } });
  const { page } = launched;
  await page.click('[data-command="sketch"]');
  await page.click('.plane-choice[data-plane="top"]');
  await drawPoint(page, 'p', 0, 0);
  await page.click('[data-testid="sketch-cancel"]');
  expect((await state(page)).sketch?.draft.sketch.entities).toHaveLength(1);
});

test('saving in sketch mode stores the sketch and stays in sketch mode', async () => {
  launched = await launchApp();
  const { page, outputDir } = launched;
  await page.click('[data-command="sketch"]');
  await page.click('.plane-choice[data-plane="right"]');
  await drawPoint(page, 'p', 3, 4);
  await page.click('[data-command="save"]');
  await expect.poll(async () => (await state(page)).dirty).toBe(false);
  const saved = await state(page);
  expect(saved.sketch?.mode).toBe('edit');
  expect(saved.history.features.map((f) => f.type)).toEqual(['sketch']);
  expect(await readdir(outputDir)).toHaveLength(1);

  // Leaving without further changes adds nothing new to the document.
  const steps = saved.history.past.length;
  await page.click('[data-testid="sketch-ok"]');
  expect((await state(page)).history.past).toHaveLength(steps);
  expect((await state(page)).dirty).toBe(false);
});
