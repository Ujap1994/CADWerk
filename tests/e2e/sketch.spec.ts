import { expect, test, type Page } from '@playwright/test';
import { readdir } from 'node:fs/promises';
import { idle, launchApp, type LaunchedApp } from './harness.ts';

interface SketchState {
  sketchSelection: string[];
  history: { features: { id: string; type: string; plane?: { kind: string; plane?: string }; sketch?: { entities: unknown[] } }[]; past: unknown[] };
  choosingSketchPlane: boolean;
  sketch: {
    mode: string;
    index: number;
    draft: { plane: { plane?: string }; sketch: { entities: { id: string; type: string; x?: number; y?: number; radius?: number }[]; constraints: { id: string }[] } };
    past: unknown[];
  } | null;
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

/** Waits for two rendered frames: labels are positioned by the frame after a change. */
async function frames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
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

test('drags under-defined geometry with live solving, selects and deletes it', async () => {
  launched = await launchApp();
  const { page } = launched;
  await page.evaluate(() => {
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const sketch = {
      entities: [
        P('r1', -40, -20), P('r2', 40, -20), P('r3', 40, 25), P('r4', -40, 25),
        { id: 'l1', type: 'line', p1: 'r1', p2: 'r2' }, { id: 'l2', type: 'line', p1: 'r2', p2: 'r3' },
        { id: 'l3', type: 'line', p1: 'r3', p2: 'r4' }, { id: 'l4', type: 'line', p1: 'r4', p2: 'r1' },
        P('c', 0, 60), { id: 'k', type: 'circle', center: 'c', radius: 10 },
        P('fixed', -60, 60),
      ],
      constraints: [
        { id: 'h1', type: 'horizontal', line: 'l1' }, { id: 'h2', type: 'horizontal', line: 'l3' },
        { id: 'v1', type: 'vertical', line: 'l2' }, { id: 'v2', type: 'vertical', line: 'l4' },
        { id: 'f', type: 'fix', point: 'fixed' },
      ],
    };
    const features = [{ id: 's', type: 'sketch', plane: { kind: 'standard', plane: 'top' }, sketch }];
    (window as unknown as { __parawerk: Hooks }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features, dirty: false });
  });
  await page.dblclick('.tree-item[data-feature-id="s"]');
  await expectNormalView(page, [1, 0, 0], [0, 1, 0]);
  const canvas = await page.locator('.viewport-canvas').boundingBox();
  if (!canvas) throw new Error('viewport not visible');
  const screen = async (u: number, v: number) => {
    const p = await project(page, [u, v, 0]);
    return { x: canvas.x + p.x, y: canvas.y + p.y };
  };
  const drag = async (from: [number, number], to: [number, number]) => {
    const a = await screen(...from);
    const b = await screen(...to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.mouse.up();
  };
  const entity = async (id: string) => (await state(page)).sketch?.draft.sketch.entities.find((e) => e.id === id);

  // Hovering shows the exact entity.
  const top = await screen(0, 25);
  await page.mouse.move(top.x, top.y);
  await expect(page.locator('[data-testid="pick-info"]')).toHaveText('Line · 80 mm');

  // Dragging a corner resizes the rectangle; the relations keep it a rectangle.
  await drag([40, 25], [50, 30]);
  await expect.poll(async () => (await state(page)).sketch?.past.length).toBe(1);
  const r3 = await entity('r3');
  expect(r3?.x).toBeCloseTo(50, 0);
  expect(r3?.y).toBeCloseTo(30, 0);
  expect((await entity('r2'))?.x).toBeCloseTo(r3?.x as number, 6);
  expect((await entity('r4'))?.y).toBeCloseTo(r3?.y as number, 6);
  expect((await entity('r1'))?.x).toBeCloseTo(-40, 6);

  // A fixed point does not move, and nothing is recorded.
  await drag([-60, 60], [-70, 70]);
  await page.waitForTimeout(300);
  expect((await state(page)).sketch?.past.length).toBe(1);
  expect((await entity('fixed'))?.x).toBeCloseTo(-60, 6);

  // Dragging the edge of a circle changes its radius.
  await drag([10, 60], [16, 60]);
  await expect.poll(async () => (await state(page)).sketch?.past.length).toBe(2);
  expect((await entity('k'))?.radius).toBeCloseTo(16, 0);

  // Undo goes back one drag at a time.
  await page.click('[data-command="undo"]');
  expect((await entity('k'))?.radius).toBeCloseTo(10, 6);

  // Click selects, Delete removes the line and its relation but keeps the shared corners.
  const bottom = await screen(0, -20);
  await page.mouse.click(bottom.x, bottom.y);
  expect((await state(page)).sketchSelection).toEqual(['l1']);
  await page.keyboard.press('Delete');
  const after = (await state(page)).sketch?.draft.sketch;
  expect(after?.entities.map((e) => e.id)).not.toContain('l1');
  expect(after?.entities.map((e) => e.id)).toContain('r1');
  expect(after?.constraints.map((c) => c.id)).not.toContain('h1');
  // Esc clears the selection.
  const topNow = await screen(0, r3?.y as number);
  await page.mouse.click(topNow.x, topNow.y);
  expect((await state(page)).sketchSelection).toEqual(['l3']);
  await page.keyboard.press('Escape');
  expect((await state(page)).sketchSelection).toEqual([]);
});

test('draws with the tools: snapping, automatic relations, drag drawing, Esc and undo', async () => {
  launched = await launchApp();
  const { page } = launched;
  await page.click('[data-command="sketch"]');
  await page.click('.plane-choice[data-plane="top"]');
  await expectNormalView(page, [1, 0, 0], [0, 1, 0]);
  const canvas = await page.locator('.viewport-canvas').boundingBox();
  if (!canvas) throw new Error('viewport not visible');
  const screen = async (u: number, v: number) => {
    const p = await project(page, [u, v, 0]);
    return { x: canvas.x + p.x, y: canvas.y + p.y };
  };
  const clickAt = async (u: number, v: number) => {
    const p = await screen(u, v);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.mouse.click(p.x, p.y);
  };
  const sketch = async () => (await state(page)).sketch?.draft.sketch;
  const count = async (type: string) => (await sketch())?.entities.filter((e) => e.type === type).length;
  const relations = async () => (await sketch())?.constraints.map((c) => (c as unknown as { type: string }).type).sort();

  // A closed chain of lines, starting at the origin, slightly off the ideal positions.
  await page.click('[data-command="tool-line"]');
  await expect(page.locator('[data-testid="sketch-tool"]')).toContainText('Line');
  await clickAt(0.3, 0.2);
  await clickAt(50, 0.5);
  await clickAt(50, 30);
  const preview = await screen(0.4, 29.6);
  await page.mouse.move(preview.x, preview.y, { steps: 3 });
  await expect(page.locator('[data-testid="sketch-cursor-info"]')).toHaveText('50 mm · 180° · Horizontal');
  await page.mouse.click(preview.x, preview.y);
  await clickAt(0, 0);
  expect(await count('line')).toBe(4);
  expect(await count('point')).toBe(3);
  expect(await relations()).toEqual(['horizontal', 'horizontal', 'vertical', 'vertical']);

  // Undo removes the last line; Esc ends a chain first, then leaves the tool.
  await page.click('[data-command="undo"]');
  expect(await count('line')).toBe(3);
  await clickAt(70, 10);
  await clickAt(90, 10);
  await page.keyboard.press('Escape');
  expect((await state(page) as unknown as { sketchTool: string | null }).sketchTool).toBe('line');
  await page.keyboard.press('Escape');
  expect((await state(page) as unknown as { sketchTool: string | null }).sketchTool).toBeNull();

  // Keyboard shortcut and drag drawing: a circle around the midpoint of the bottom line.
  await page.keyboard.press('c');
  const center = await screen(25, 0.3);
  // Below the line, where nothing else lines up (snapping depends on the zoom level).
  const rim = await screen(25, -8);
  await page.mouse.move(center.x, center.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.move(rim.x, rim.y, { steps: 8 });
  await page.mouse.up();
  const circle = (await sketch())?.entities.find((e) => e.type === 'circle');
  expect(circle?.radius).toBeCloseTo(8, 0);
  expect(await relations()).toContain('midpoint');

  // Center rectangle from the variants menu, then turned into construction geometry.
  await page.click('.split-toggle[data-variants="cornerRectangle centerRectangle"]');
  await page.click('.menu-item[data-tool="centerRectangle"]');
  await clickAt(-40, 40);
  await clickAt(-30, 46);
  expect(await count('line')).toBe(4 + 6);
  await page.keyboard.press('Escape');
  // A point on the bottom edge of the center rectangle, away from corners and its midpoint.
  const edge = await screen(-45, 34);
  await page.mouse.click(edge.x, edge.y);
  const selected = (await state(page)).sketchSelection;
  expect(selected).toHaveLength(1);
  await page.click('[data-command="construction"]');
  const line = (await sketch())?.entities.find((e) => e.id === selected[0]) as { construction?: boolean } | undefined;
  expect(line?.construction).toBe(true);

  // The finished sketch is valid and keeps all of it.
  await page.click('[data-testid="sketch-ok"]');
  const feature = (await state(page)).history.features[0];
  expect(feature?.type).toBe('sketch');
  expect(feature?.sketch?.entities.length).toBeGreaterThan(15);
});

test('adds relations to selected geometry, refuses over-defining ones and deletes them', async () => {
  launched = await launchApp();
  const { page } = launched;
  await page.evaluate(() => {
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const sketch = {
      entities: [P('a', 0, 0), P('b', 40, 6), { id: 'l1', type: 'line', p1: 'a', p2: 'b' }, P('c', 0, 30), P('d', 40, 40), { id: 'l2', type: 'line', p1: 'c', p2: 'd' }],
      constraints: [],
    };
    const features = [{ id: 's', type: 'sketch', plane: { kind: 'standard', plane: 'top' }, sketch }];
    (window as unknown as { __parawerk: Hooks }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features, dirty: false });
  });
  await page.dblclick('.tree-item[data-feature-id="s"]');
  await expectNormalView(page, [1, 0, 0], [0, 1, 0]);
  const canvas = await page.locator('.viewport-canvas').boundingBox();
  if (!canvas) throw new Error('viewport not visible');
  const click = async (u: number, v: number, modifiers: ('Shift' | 'Meta' | 'Control')[] = []) => {
    const p = await project(page, [u, v, 0]);
    await page.mouse.move(canvas.x + p.x, canvas.y + p.y);
    for (const key of modifiers) await page.keyboard.down(key);
    await page.mouse.click(canvas.x + p.x, canvas.y + p.y);
    for (const key of modifiers) await page.keyboard.up(key);
  };
  const constraints = async () => ((await state(page)).sketch?.draft.sketch.constraints ?? []).map((c) => (c as unknown as { type: string }).type);
  const y = async (id: string) => (await state(page)).sketch?.draft.sketch.entities.find((e) => e.id === id)?.y as number;

  // One line: horizontal and vertical are offered; horizontal straightens it.
  await click(20, 3);
  await expect(page.locator('[data-testid="sketch-selection"] .relation-button')).toHaveText(['Horizontal', 'Vertical']);
  await page.click('.relation-button[data-relation="horizontal"]');
  await expect.poll(constraints).toEqual(['horizontal']);
  expect(await y('b')).toBeCloseTo(await y('a'), 6);
  await expect(page.locator('.relation-item')).toHaveText(['Horizontal']);

  // Two lines: parallel makes the second one horizontal too ...
  await click(20, 35, ['Shift']);
  expect((await state(page)).sketchSelection).toHaveLength(2);
  await page.click('.relation-button[data-relation="parallel"]');
  await expect.poll(constraints).toEqual(['horizontal', 'parallel']);
  expect(await y('d')).toBeCloseTo(await y('c'), 6);

  // ... so making it horizontal as well would over-define the sketch: refused with a message.
  const second = (await y('c')) as number;
  await click(20, second);
  await page.click('.relation-button[data-relation="horizontal"]');
  await expect(page.locator('.toast')).toContainText('over-define');
  expect(await constraints()).toEqual(['horizontal', 'parallel']);

  // Relations of the selection can be deleted from the list.
  await page.click('.relation-item[data-constraint] .icon-button');
  expect(await constraints()).toEqual(['horizontal']);
});

test('fits the smallest window in sketch mode: nothing overflows, the whole view is reachable', async () => {
  launched = await launchApp({ width: 960, height: 600 });
  const { page } = launched;
  await page.click('[data-command="sketch"]');
  await page.click('.plane-choice[data-plane="top"]');
  await expect(page.locator('[data-command="tool-line"]')).toBeVisible();
  const layout = await page.evaluate(() => {
    const canvas = document.querySelector('.viewport-canvas')?.getBoundingClientRect();
    const bar = document.querySelector('.command-bar') as HTMLElement;
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      canvasRight: canvas?.right ?? Infinity,
      barOverflow: bar.scrollWidth - bar.clientWidth,
    };
  });
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth);
  // The command bar picks a density at which nothing has to scroll.
  expect(layout.barOverflow).toBeLessThanOrEqual(1);
  expect(layout.canvasRight).toBeLessThanOrEqual(layout.innerWidth);
  // Every command of the sketch tab is on screen.
  for (const command of ['exit-sketch', 'tool-dimension', 'tool-line', 'tool-slot', 'tool-polygon', 'tool-point', 'tool-sketchFillet', 'construction', 'delete-sketch', 'settings', 'about']) {
    const box = await page.locator(`[data-command="${command}"]`).boundingBox();
    expect(box && box.x + box.width <= layout.innerWidth).toBe(true);
  }
});

test('dimensions: placing with a value, reference dimensions, editing, moving and deleting', async () => {
  launched = await launchApp();
  const { page } = launched;
  await page.evaluate(() => {
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const sketch = {
      entities: [
        P('r1', 0, 0), P('r2', 46, 0), P('r3', 46, 27), P('r4', 0, 27),
        { id: 'l1', type: 'line', p1: 'r1', p2: 'r2' }, { id: 'l2', type: 'line', p1: 'r2', p2: 'r3' },
        { id: 'l3', type: 'line', p1: 'r3', p2: 'r4' }, { id: 'l4', type: 'line', p1: 'r4', p2: 'r1' },
        P('m', 25, 14), { id: 'k', type: 'circle', center: 'm', radius: 6 },
      ],
      constraints: [
        { id: 'o', type: 'coincident', a: 'r1', b: 'origin' },
        { id: 'h1', type: 'horizontal', line: 'l1' }, { id: 'h2', type: 'horizontal', line: 'l3' },
        { id: 'v1', type: 'vertical', line: 'l2' }, { id: 'v2', type: 'vertical', line: 'l4' },
      ],
    };
    const features = [{ id: 's', type: 'sketch', plane: { kind: 'standard', plane: 'top' }, sketch }];
    (window as unknown as { __parawerk: Hooks }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features, dirty: false });
  });
  await page.dblclick('.tree-item[data-feature-id="s"]');
  await expectNormalView(page, [1, 0, 0], [0, 1, 0]);
  const canvas = await page.locator('.viewport-canvas').boundingBox();
  if (!canvas) throw new Error('viewport not visible');
  const click = async (u: number, v: number) => {
    const p = await project(page, [u, v, 0]);
    await page.mouse.move(canvas.x + p.x, canvas.y + p.y, { steps: 3 });
    await page.mouse.click(canvas.x + p.x, canvas.y + p.y);
  };
  const editor = page.locator('[data-testid="dimension-editor"]');
  const entity = async (id: string) => (await state(page)).sketch?.draft.sketch.entities.find((e) => e.id === id);
  const dimensions = async () =>
    ((await state(page)).sketch?.draft.sketch.constraints ?? []).filter((c) => 'value' in c) as unknown as { id: string; type: string; value: number; driving: boolean; offset?: number[] }[];

  // The width: pick the bottom line, place the value below it, type it.
  await page.keyboard.press('d');
  await click(20, 0);
  await click(23, -10);
  await expect(editor).toHaveValue('46');
  await editor.fill('50');
  await editor.press('Enter');
  await expect.poll(async () => (await entity('r2'))?.x).toBeCloseTo(50, 6);
  await expect(page.locator('.dimension-label')).toHaveText(['50']);

  // The height, placed beside the right line.
  await click(50, 13);
  await click(62, 13);
  await editor.fill('30');
  await editor.press('Enter');
  await expect.poll(async () => (await entity('r3'))?.y).toBeCloseTo(30, 6);

  // The circle: its diameter; Esc keeps the measured value.
  await click(31, 14);
  await click(40, 26);
  await expect(editor).toHaveValue('12');
  await editor.press('Escape');
  await expect.poll(async () => (await dimensions()).map((d) => d.type)).toEqual(['distance', 'distance', 'diameter']);

  // The top line is already defined by the width: it becomes a reference dimension.
  await click(25, 30);
  await click(25, 38);
  await editor.press('Enter');
  await expect(page.locator('.toast')).toContainText('reference dimension');
  await expect.poll(async () => (await dimensions()).at(-1)?.driving).toBe(false);
  await expect(page.locator('.dimension-label.is-driven')).toHaveText(['(50)']);

  // Double-click a value to change it; the geometry follows.
  await page.keyboard.press('Escape');
  await frames(page);
  const width = page.locator('.dimension-label', { hasText: /^50$/ });
  const box = await width.boundingBox();
  if (!box) throw new Error('label not visible');
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(editor).toBeVisible();
  await editor.fill('60');
  await editor.press('Enter');
  await expect.poll(async () => (await entity('r2'))?.x).toBeCloseTo(60, 6);
  await expect(page.locator('.dimension-label.is-driven')).toHaveText(['(60)']);

  // Dragging a value moves only the label.
  await frames(page);
  const label = await page.locator('.dimension-label', { hasText: /^60$/ }).boundingBox();
  if (!label) throw new Error('label not visible');
  const before = (await dimensions())[0]?.offset ?? [0, 0];
  await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2);
  await page.mouse.down();
  await page.mouse.move(label.x + label.width / 2 + 60, label.y + label.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => ((await dimensions())[0]?.offset ?? [0, 0])[0]).toBeGreaterThan((before[0] ?? 0) + 1);
  expect((await entity('r2'))?.x).toBeCloseTo(60, 6);

  // The double-click selected the dimension (a further click would deselect it); Delete removes it.
  await expect(page.locator('[data-testid="sketch-selection"]')).toContainText('1 dimension selected');
  await page.keyboard.press('Delete');
  expect((await dimensions()).map((d) => d.type)).toEqual(['distance', 'diameter', 'distance']);
});

test('shows under, fully and over defined sketches and lets conflicts be deleted', async () => {
  launched = await launchApp();
  const { page } = launched;
  await page.evaluate(() => {
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const rect = [
      P('r1', 0, 0), P('r2', 50, 0), P('r3', 50, 30), P('r4', 0, 30),
      { id: 'l1', type: 'line', p1: 'r1', p2: 'r2' }, { id: 'l2', type: 'line', p1: 'r2', p2: 'r3' },
      { id: 'l3', type: 'line', p1: 'r3', p2: 'r4' }, { id: 'l4', type: 'line', p1: 'r4', p2: 'r1' },
    ];
    const defined = [
      { id: 'o', type: 'coincident', a: 'r1', b: 'origin' },
      { id: 'h1', type: 'horizontal', line: 'l1' }, { id: 'h2', type: 'horizontal', line: 'l3' },
      { id: 'v1', type: 'vertical', line: 'l2' }, { id: 'v2', type: 'vertical', line: 'l4' },
      { id: 'w', type: 'distance', a: 'r1', b: 'r2', value: 50, driving: true },
      { id: 'hh', type: 'distance', a: 'r2', b: 'r3', value: 30, driving: true },
    ];
    const features = [
      { id: 'under', type: 'sketch', plane: { kind: 'standard', plane: 'top' }, sketch: { entities: rect, constraints: defined.slice(0, 6) } },
      { id: 'full', type: 'sketch', plane: { kind: 'standard', plane: 'front' }, sketch: { entities: rect, constraints: defined } },
      {
        id: 'over',
        type: 'sketch',
        plane: { kind: 'standard', plane: 'right' },
        sketch: { entities: rect, constraints: [...defined, { id: 'bad', type: 'horizontalDistance', a: 'r1', b: 'r2', value: 40, driving: true }] },
      },
    ];
    (window as unknown as { __parawerk: Hooks }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features, dirty: false });
  });

  // The feature tree marks sketches that are not fully defined.
  await expect(page.locator('.tree-item[data-feature-id="under"] [data-sketch-status="under"]')).toBeVisible();
  await expect(page.locator('.tree-item[data-feature-id="over"] [data-sketch-status="over"]')).toBeVisible();
  await expect(page.locator('.tree-item[data-feature-id="full"] [data-sketch-status]')).toHaveCount(0);

  await page.dblclick('.tree-item[data-feature-id="under"]');
  await expect(page.locator('[data-testid="sketch-status"]')).toHaveText('Under defined');
  await expect(page.locator('[data-testid="status-sketch"]')).toHaveText('Under defined');
  await page.click('[data-testid="sketch-ok"]');

  await page.dblclick('.tree-item[data-feature-id="full"]');
  await expect(page.locator('[data-testid="sketch-status"]')).toHaveText('Fully defined');
  await page.click('[data-testid="sketch-ok"]');

  // Over defined: both conflicting dimensions are listed and shown in red; deleting one solves it.
  await page.dblclick('.tree-item[data-feature-id="over"]');
  await expect(page.locator('[data-testid="sketch-status"]')).toHaveText('Over defined');
  await expect(page.locator('[data-testid="sketch-conflicts"] .relation-item')).toHaveText(['Distance', 'Horizontal distance']);
  await expect(page.locator('.dimension-label.is-conflict')).toHaveCount(2);
  await page.click('[data-testid="sketch-conflicts"] .relation-item[data-constraint="bad"] .icon-button');
  await expect(page.locator('[data-testid="sketch-status"]')).toHaveText('Fully defined');
  await expect(page.locator('.dimension-label.is-conflict')).toHaveCount(0);
  await page.click('[data-testid="sketch-ok"]');
  await expect(page.locator('.tree-item[data-feature-id="over"] [data-sketch-status]')).toHaveCount(0);
});

test('draws tangent arcs, three-point circles, slots and polygons', async () => {
  launched = await launchApp();
  const { page } = launched;
  await page.click('[data-command="sketch"]');
  await page.click('.plane-choice[data-plane="top"]');
  await expectNormalView(page, [1, 0, 0], [0, 1, 0]);
  const canvas = await page.locator('.viewport-canvas').boundingBox();
  if (!canvas) throw new Error('viewport not visible');
  const clickAt = async (u: number, v: number) => {
    const p = await project(page, [u, v, 0]);
    await page.mouse.move(canvas.x + p.x, canvas.y + p.y, { steps: 3 });
    await page.mouse.click(canvas.x + p.x, canvas.y + p.y);
  };
  const sketch = async () => (await state(page)).sketch?.draft.sketch;
  const count = async (type: string, construction = false) => (await sketch())?.entities.filter((e) => e.type === type && Boolean((e as { construction?: boolean }).construction) === construction).length;
  const relations = async () => ((await sketch())?.constraints ?? []).map((c) => (c as unknown as { type: string }).type);

  // A line, then an arc that continues it tangentially (Arc ▾ > Tangent arc).
  await page.keyboard.press('l');
  await clickAt(-60, -40);
  await clickAt(-20, -40);
  await page.keyboard.press('Escape');
  await page.click('.split-toggle[data-variants="centerArc threePointArc tangentArc"]');
  await page.click('.menu-item[data-tool="tangentArc"]');
  await clickAt(-20, -40);
  await clickAt(-5, -25);
  expect(await count('arc')).toBe(1);
  expect(await relations()).toContain('tangent');

  // Circle ▾ > 3-point circle.
  await page.click('.split-toggle[data-variants="circle threePointCircle"]');
  await page.click('.menu-item[data-tool="threePointCircle"]');
  await clickAt(40, -40);
  await clickAt(50, -30);
  await clickAt(40, -20);
  expect(await count('circle')).toBe(1);

  // A slot: two centers and the width.
  await page.click('[data-command="tool-slot"]');
  await clickAt(-50, 20);
  await clickAt(-10, 20);
  await clickAt(-30, 28);
  expect(await count('arc')).toBe(3);
  expect((await relations()).filter((type) => type === 'tangent')).toHaveLength(5);

  // A pentagon: the number of sides is set in the side panel.
  await page.click('[data-command="tool-polygon"]');
  await page.locator('[data-testid="polygon-sides"]').fill('5');
  await page.locator('[data-testid="polygon-sides"]').press('Enter');
  await clickAt(40, 30);
  await clickAt(55, 33);
  expect(await count('line')).toBe(1 + 2 + 5);
  expect(await count('circle', true)).toBe(1);
  await page.click('[data-testid="sketch-ok"]');
  expect((await state(page)).history.features).toHaveLength(1);
});

test('rounds and bevels corners of a fully defined rectangle, keeping it fully defined', async () => {
  launched = await launchApp();
  const { page } = launched;
  await page.evaluate(() => {
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const sketch = {
      entities: [
        P('b', 50, 0), P('c', 50, 30), P('d', 0, 30),
        { id: 'l1', type: 'line', p1: 'origin', p2: 'b' }, { id: 'l2', type: 'line', p1: 'b', p2: 'c' },
        { id: 'l3', type: 'line', p1: 'c', p2: 'd' }, { id: 'l4', type: 'line', p1: 'd', p2: 'origin' },
      ],
      constraints: [
        { id: 'h1', type: 'horizontal', line: 'l1' }, { id: 'v1', type: 'vertical', line: 'l2' },
        { id: 'h2', type: 'horizontal', line: 'l3' }, { id: 'v2', type: 'vertical', line: 'l4' },
        { id: 'w', type: 'distance', a: 'origin', b: 'b', value: 50, driving: true, offset: [0, -8] },
        { id: 'h', type: 'distance', a: 'b', b: 'c', value: 30, driving: true, offset: [8, 0] },
      ],
    };
    const features = [{ id: 's', type: 'sketch', plane: { kind: 'standard', plane: 'top' }, sketch }];
    (window as unknown as { __parawerk: Hooks }).__parawerk.setState({ history: { features, past: [], future: [] }, savedFeatures: features, dirty: false });
  });
  await page.dblclick('.tree-item[data-feature-id="s"]');
  await expectNormalView(page, [1, 0, 0], [0, 1, 0]);
  await expect(page.locator('[data-testid="sketch-status"]')).toHaveText('Fully defined');
  const canvas = await page.locator('.viewport-canvas').boundingBox();
  if (!canvas) throw new Error('viewport not visible');
  const clickAt = async (u: number, v: number) => {
    const p = await project(page, [u, v, 0]);
    await page.mouse.move(canvas.x + p.x, canvas.y + p.y, { steps: 3 });
    await page.mouse.click(canvas.x + p.x, canvas.y + p.y);
  };
  const sketch = async () => (await state(page)).sketch?.draft.sketch;

  // Fillet (Modify group), radius 6, at the corner (50, 0).
  await page.click('[data-command="tool-sketchFillet"]');
  await page.locator('[data-testid="corner-size"]').fill('6');
  await clickAt(50, 0);
  expect((await sketch())?.entities.filter((e) => e.type === 'arc')).toHaveLength(1);
  await expect(page.locator('.dimension-label', { hasText: 'R6' })).toBeVisible();
  await expect(page.locator('[data-testid="sketch-status"]')).toHaveText('Fully defined');

  // A radius that does not fit is refused with a message.
  await page.locator('[data-testid="corner-size"]').fill('40');
  await clickAt(50, 30);
  await expect(page.locator('.toast')).toContainText('too large');

  // Chamfer the opposite corner by 5.
  await page.click('.split-toggle[data-variants="sketchFillet sketchChamfer"]');
  await page.click('.menu-item[data-tool="sketchChamfer"]');
  await page.locator('[data-testid="corner-size"]').fill('5');
  await clickAt(0, 30);
  expect((await sketch())?.entities.filter((e) => e.type === 'line')).toHaveLength(5);
  await expect(page.locator('[data-testid="sketch-status"]')).toHaveText('Fully defined');

  // Changing the width keeps the rounded and beveled corners.
  await page.keyboard.press('Escape');
  await frames(page);
  const width = await page.locator('.dimension-label', { hasText: /^50$/ }).boundingBox();
  if (!width) throw new Error('label not visible');
  await page.mouse.dblclick(width.x + width.width / 2, width.y + width.height / 2);
  await page.locator('[data-testid="dimension-editor"]').fill('70');
  await page.locator('[data-testid="dimension-editor"]').press('Enter');
  await expect.poll(async () => ((await sketch())?.entities.find((e) => e.id === 'b') as { x: number } | undefined)?.x).toBeCloseTo(70, 6);
  await expect(page.locator('[data-testid="sketch-status"]')).toHaveText('Fully defined');
});
