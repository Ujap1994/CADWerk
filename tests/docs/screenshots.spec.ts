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

  // Sketch mode: choosing the plane (the hovered plane is highlighted), then sketching on it.
  await page.click('[data-command="sketch"]');
  await page.hover('.plane-choice[data-plane="front"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('sketch-choose-plane.png') });
  const topFace = await page.evaluate(
    ([x, y, z]) => (window as unknown as { __parawerk: { viewport: { project(x: number, y: number, z: number): { x: number; y: number } } } }).__parawerk.viewport.project(x, y, z),
    [45, -28, 20] as const,
  );
  if (canvas) await page.mouse.move(canvas.x + topFace.x, canvas.y + topFace.y);
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('sketch-choose-face.png') });
  await page.click('.plane-choice[data-plane="front"]');
  await idle(page);
  await page.waitForTimeout(700);
  await page.screenshot({ path: out('sketch-mode.png') });
  await page.click('[data-testid="sketch-cancel"]');
  await idle(page);

  // An existing sketch on the top face: geometry, hover information and the other sketches' look.
  const before = await page.evaluate(() => {
    const hooks = (window as unknown as { __parawerk: { setState(s: unknown): void; getState(): { history: { features: unknown[] } } } }).__parawerk;
    const features = hooks.getState().history.features;
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const sketch = {
      entities: [
        P('a', -52, -32), P('b', -10, -32), P('c', -10, 32), P('d', -52, 32),
        { id: 'l1', type: 'line', p1: 'a', p2: 'b' }, { id: 'l2', type: 'line', p1: 'b', p2: 'c' },
        { id: 'l3', type: 'line', p1: 'c', p2: 'd' }, { id: 'l4', type: 'line', p1: 'd', p2: 'a' },
        P('m', 42, 0), { id: 'k', type: 'circle', center: 'm', radius: 9 },
        P('x1', -60, 0), P('x2', 60, 0), { id: 'axis', type: 'line', p1: 'x1', p2: 'x2', construction: true },
      ],
      constraints: [
        { id: 'h1', type: 'horizontal', line: 'l1' }, { id: 'v1', type: 'vertical', line: 'l2' },
        { id: 'h2', type: 'horizontal', line: 'l3' }, { id: 'v2', type: 'vertical', line: 'l4' },
      ],
    };
    const frame = { origin: [0, 0, 20], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
    const withSketch = [...features, { id: 'doc-sketch', type: 'sketch', plane: { kind: 'face', face: 0, frame }, sketch }];
    hooks.setState({ history: { features: withSketch, past: [], future: [] } });
    return features;
  });
  await idle(page);
  await page.dblclick('.tree-item[data-feature-id="doc-sketch"]');
  await idle(page);
  await page.waitForTimeout(700);
  const lineMiddle = await page.evaluate(
    ([x, y, z]) => (window as unknown as { __parawerk: { viewport: { project(x: number, y: number, z: number): { x: number; y: number } } } }).__parawerk.viewport.project(x, y, z),
    [-10, 10, 20] as const,
  );
  if (canvas) await page.mouse.move(canvas.x + lineMiddle.x, canvas.y + lineMiddle.y);
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('sketch-geometry.png') });

  // Drawing a line from a corner: preview, measurement, horizontal relation and an inference line.
  const sketchPoint = (u: number, v: number) =>
    page.evaluate(
      ([x, y, z]) => (window as unknown as { __parawerk: { viewport: { project(x: number, y: number, z: number): { x: number; y: number } } } }).__parawerk.viewport.project(x, y, z),
      [u, v, 20] as const,
    );
  await page.keyboard.press('l');
  const corner = await sketchPoint(-10, 32);
  const target = await sketchPoint(41.6, 32.4);
  if (canvas) {
    await page.mouse.move(canvas.x + corner.x, canvas.y + corner.y, { steps: 4 });
    await page.mouse.click(canvas.x + corner.x, canvas.y + corner.y);
    await page.mouse.move(canvas.x + target.x, canvas.y + target.y, { steps: 6 });
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('sketch-drawing.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Two selected lines: the side panel offers the relations that fit and lists the existing ones.
  const bottom = await sketchPoint(-31, -32);
  const top = await sketchPoint(-31, 32);
  if (canvas) {
    await page.mouse.click(canvas.x + bottom.x, canvas.y + bottom.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(canvas.x + top.x, canvas.y + top.y);
    await page.keyboard.up('Shift');
    await page.mouse.move(canvas.x + 40, canvas.y + 40);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('sketch-relations.png') });
  await page.keyboard.press('Escape');

  // Dimensions: pick the bottom line, place the value below it and type it; then the circle's diameter.
  await page.keyboard.press('d');
  const clickSketch = async (u: number, v: number) => {
    const p = await sketchPoint(u, v);
    if (!canvas) return;
    await page.mouse.move(canvas.x + p.x, canvas.y + p.y, { steps: 3 });
    await page.mouse.click(canvas.x + p.x, canvas.y + p.y);
  };
  await clickSketch(-31, -32);
  await clickSketch(-31, -43);
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('sketch-dimension-value.png') });
  await page.locator('[data-testid="dimension-editor"]').fill('40');
  await page.keyboard.press('Enter');
  await idle(page);
  await clickSketch(-10, 10);
  await clickSketch(-2, 22);
  await page.locator('[data-testid="dimension-editor"]').fill('60');
  await page.keyboard.press('Enter');
  await clickSketch(42, 9);
  await clickSketch(56, 20);
  await page.locator('[data-testid="dimension-editor"]').fill('16');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  if (canvas) await page.mouse.move(canvas.x + 40, canvas.y + 40);
  await page.waitForTimeout(500);
  await page.screenshot({ path: out('sketch-dimensions.png') });

  // Relation symbols: pointing at one highlights the geometry it relates.
  const symbols = await page.evaluate(() =>
    (window as unknown as { __parawerk: { viewport: { relationGlyphs(): { kind: string; x: number; y: number }[] } } }).__parawerk.viewport.relationGlyphs(),
  );
  const symbol = symbols.find((glyph) => glyph.kind === 'horizontal');
  if (symbol && canvas) await page.mouse.move(canvas.x + symbol.x, canvas.y + symbol.y);
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('sketch-relation-symbols.png') });
  if (canvas) await page.mouse.move(canvas.x + 40, canvas.y + 40);

  // A conflicting dimension: the sketch is over defined, the conflict is red and listed.
  await page.evaluate(() => {
    const hooks = (window as unknown as {
      __parawerk: { getState(): { sketch: { draft: { sketch: { entities: unknown[]; constraints: unknown[] } } } }; commands: { recordSketchChange(s: unknown): void } };
    }).__parawerk;
    const sketch = hooks.getState().sketch.draft.sketch;
    hooks.commands.recordSketchChange({
      ...sketch,
      constraints: [...sketch.constraints, { id: 'conflict', type: 'horizontalDistance', a: 'a', b: 'b', value: 35, driving: true, offset: [0, -20] }],
    });
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: out('sketch-conflict.png') });
  await page.click('[data-command="undo"]');
  await page.waitForTimeout(300);
  await page.click('[data-testid="sketch-ok"]');
  await page.evaluate(() => (window as unknown as { __parawerk: { commands: { setView(v: string): void } } }).__parawerk.commands.setView('isometric'));
  await idle(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: out('sketch-in-model.png') });
  await page.evaluate((features) => {
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] } });
  }, before);
  await idle(page);

  // More drawing tools on the front plane, above the part: a line with a tangent arc, a slot, a hexagon.
  await page.click('[data-command="sketch"]');
  await page.click('.plane-choice[data-plane="front"]');
  await idle(page);
  await page.waitForTimeout(600);
  const front = async (u: number, v: number) => {
    const p = await page.evaluate(
      ([x, y, z]) => (window as unknown as { __parawerk: { viewport: { project(x: number, y: number, z: number): { x: number; y: number } } } }).__parawerk.viewport.project(x, y, z),
      [u, 0, v] as const,
    );
    if (!canvas) return;
    await page.mouse.move(canvas.x + p.x, canvas.y + p.y, { steps: 3 });
    await page.mouse.click(canvas.x + p.x, canvas.y + p.y);
  };
  await page.keyboard.press('l');
  await front(-75, 75);
  await front(-40, 75);
  await page.keyboard.press('Escape');
  await page.click('.split-toggle[data-variants="centerArc threePointArc tangentArc"]');
  await page.click('.menu-item[data-tool="tangentArc"]');
  await front(-40, 75);
  await front(-25, 92);
  await page.click('[data-command="tool-slot"]');
  await front(-5, 88);
  await front(30, 88);
  await front(12, 96);
  await page.click('[data-command="tool-polygon"]');
  await front(65, 90);
  await front(78, 90);
  // A rectangle with a rounded and a beveled corner.
  await page.keyboard.press('r');
  await front(-130, 70);
  await front(-92, 100);
  await page.click('[data-command="tool-sketchFillet"]');
  await page.locator('[data-testid="corner-size"]').fill('8');
  await front(-92, 100);
  await page.click('.split-toggle[data-variants="sketchFillet sketchChamfer"]');
  await page.click('.menu-item[data-tool="sketchChamfer"]');
  await page.locator('[data-testid="corner-size"]').fill('6');
  await front(-130, 70);
  await page.keyboard.press('Escape');
  if (canvas) await page.mouse.move(canvas.x + 40, canvas.y + 40);
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('sketch-tools.png') });

  // Trim: a line across the slot; the piece of the slot's top side left of it turns red under the cursor.
  // (Right of the middle: the view toolbar floats above the slot.)
  await page.keyboard.press('l');
  await front(22, 80);
  await front(22, 102);
  await page.keyboard.press('Escape');
  await page.keyboard.press('t');
  {
    const p = await page.evaluate(
      ([x, y, z]) => (window as unknown as { __parawerk: { viewport: { project(x: number, y: number, z: number): { x: number; y: number } } } }).__parawerk.viewport.project(x, y, z),
      [3, 0, 96] as const,
    );
    if (canvas) await page.mouse.move(canvas.x + p.x, canvas.y + p.y, { steps: 3 });
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('sketch-trim.png') });
  await page.keyboard.press('Escape');

  // A row of holes: one circle, then a linear pattern from the side panel.
  await page.keyboard.press('c');
  await front(-125, 52);
  await front(-122, 52);
  await page.keyboard.press('Escape');
  await front(-122, 52);
  await page.click('[data-transform="linear"]');
  await page.locator('[data-testid="pattern-count"]').fill('4');
  await page.locator('[data-testid="pattern-step-x"]').fill('11');
  await page.click('[data-testid="sketch-transform"] .transform-action');
  if (canvas) await page.mouse.move(canvas.x + 40, canvas.y + 40);
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('sketch-pattern.png') });
  await page.click('[data-testid="sketch-cancel"]');
  await idle(page);

  // The fully defined bracket profile of the user guide's example (as the exit-check test draws it).
  const model = await page.evaluate(() => (window as unknown as { __parawerk: { getState(): { history: { features: unknown[] } } } }).__parawerk.getState().history.features);
  await page.evaluate(() => {
    const P = (id: string, x: number, y: number) => ({ id, type: 'point', x, y });
    const L = (id: string, p1: string, p2: string) => ({ id, type: 'line', p1, p2 });
    const D = (id: string, a: string, b: string, value: number, offset: [number, number], driving = true) => ({ id, type: 'distance', a, b, value, driving, offset });
    const sketch = {
      entities: [
        P('p1', 60, 0), L('l1', 'origin', 'p1'), P('p2', 60, 10), L('l2', 'p1', 'p2'), P('p3', 10, 10), L('l3', 'p2', 'p3'),
        P('p4', 10, 40), L('l4', 'p3', 'p4'), P('p5', 0, 40), L('l5', 'p4', 'p5'), L('l6', 'p5', 'origin'),
        P('p6', 45, 5), { id: 'c1', type: 'circle', center: 'p6', radius: 3 }, P('p7', 5, 30), { id: 'c2', type: 'circle', center: 'p7', radius: 3 },
      ],
      constraints: [
        { id: 'r1', type: 'horizontal', line: 'l1' }, { id: 'r2', type: 'vertical', line: 'l2' }, { id: 'r3', type: 'horizontal', line: 'l3' },
        { id: 'r4', type: 'vertical', line: 'l4' }, { id: 'r5', type: 'horizontal', line: 'l5' }, { id: 'r6', type: 'vertical', line: 'l6' },
        { id: 'r7', type: 'equal', a: 'c1', b: 'c2' },
        D('d1', 'origin', 'p1', 60, [0, -7]), D('d2', 'p1', 'p2', 10, [7, 0]), D('d3', 'p4', 'p5', 10, [-1, 7]), D('d4', 'p5', 'origin', 40, [-7, 0]),
        { id: 'd5', type: 'diameter', circle: 'c1', value: 6, driving: true, offset: [-9, -10] },
        D('d6', 'p6', 'l1', 5, [8, -0.5]), D('d7', 'p6', 'l2', 15, [-0.5, -14]), D('d8', 'p7', 'l6', 5, [-10.5, 0]), D('d9', 'p7', 'l5', 10, [11, 0]),
        D('d10', 'p2', 'p3', 50, [0, 5], false),
      ],
    };
    const features = [{ id: 'bracket', type: 'sketch', plane: { kind: 'standard', plane: 'top' }, sketch }];
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] } });
  });
  await idle(page);
  await page.dblclick('.tree-item[data-feature-id="bracket"]');
  await idle(page);
  await page.waitForTimeout(600);
  await page.click('[data-testid="zoom-to-fit"]');
  if (canvas) await page.mouse.move(canvas.x + 40, canvas.y + 40);
  await page.waitForTimeout(800);
  await page.screenshot({ path: out('sketch-bracket.png') });
  await page.click('[data-testid="sketch-ok"]');
  await page.evaluate((features) => {
    (window as unknown as { __parawerk: { setState(s: unknown): void } }).__parawerk.setState({ history: { features, past: [], future: [] } });
  }, model);
  await idle(page);

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
