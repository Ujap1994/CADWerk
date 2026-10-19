import { describe, expect, it } from 'vitest';
import { SketchBuilder } from '../../src/renderer/src/sketch/builder.ts';
import { pointPositions } from '../../src/renderer/src/sketch/geometry.ts';
import { snapCursor } from '../../src/renderer/src/sketch/snap.ts';
import { circumcenter, createTool, DEFAULT_TOOL_OPTIONS, type SketchTool, type ToolEvent } from '../../src/renderer/src/sketch/tools.ts';
import { ORIGIN_ID, type SketchData, type SketchEntity } from '../../src/shared/model/sketch.ts';
import { parseSketchData } from '../../src/shared/model/validate-sketch.ts';
import { solveSketch } from '../../src/sketch/solver/index.ts';

const EMPTY: SketchData = { entities: [], constraints: [] };
const event = (u: number, v: number): ToolEvent => ({ u, v, tolerance: 1, alignTolerance: 0.6 });

/** Runs clicks through a tool like the controller does: every finished shape becomes the new sketch. */
function draw(tool: SketchTool, clicks: [number, number][], sketch: SketchData = EMPTY): SketchData {
  let current = sketch;
  for (const [u, v] of clicks) {
    tool.hover(current, event(u, v));
    const step = tool.click(current, event(u, v));
    if (step.commit) current = step.commit;
  }
  return current;
}

/** The sketch is valid for the file format and already satisfies all of its relations. */
function expectConsistent(sketch: SketchData): void {
  expect(() => parseSketchData(JSON.parse(JSON.stringify(sketch)))).not.toThrow();
  const solution = solveSketch(sketch);
  expect(solution.converged).toBe(true);
  expect(solution.unsatisfied).toEqual([]);
  for (const entity of sketch.entities) {
    const solved = solution.sketch.entities.find((e) => e.id === entity.id) as SketchEntity;
    if (entity.type === 'point' && solved.type === 'point') {
      expect(solved.x).toBeCloseTo(entity.x, 6);
      expect(solved.y).toBeCloseTo(entity.y, 6);
    }
  }
}

const types = (sketch: SketchData) => sketch.constraints.map((c) => c.type).sort();

describe('snapping', () => {
  const sketch: SketchData = {
    entities: [
      { id: 'a', type: 'point', x: 10, y: 10 },
      { id: 'b', type: 'point', x: 30, y: 10 },
      { id: 'l', type: 'line', p1: 'a', p2: 'b' },
      { id: 'm', type: 'point', x: 60, y: 40 },
      { id: 'k', type: 'circle', center: 'm', radius: 10 },
    ],
    constraints: [],
  };
  const positions = pointPositions(sketch);
  const options = { tolerance: 1, alignTolerance: 0.6 };

  it('snaps to points (including the origin), then midpoints, then curves', () => {
    expect(snapCursor(sketch, positions, 0.4, -0.3, options)).toMatchObject({ u: 0, v: 0, target: { kind: 'point', id: ORIGIN_ID } });
    expect(snapCursor(sketch, positions, 29.5, 10.5, options)).toMatchObject({ u: 30, v: 10, target: { kind: 'point', id: 'b' } });
    expect(snapCursor(sketch, positions, 20.4, 10.5, options)).toMatchObject({ u: 20, v: 10, target: { kind: 'midpoint', line: 'l' } });
    expect(snapCursor(sketch, positions, 15, 10.8, options)).toMatchObject({ u: 15, v: 10, target: { kind: 'curve', curve: 'l', curveType: 'line' } });
    const onCircle = snapCursor(sketch, positions, 70.5, 40.2, options);
    expect(onCircle.target).toEqual({ kind: 'curve', curve: 'k', curveType: 'circle' });
    expect(Math.hypot(onCircle.u - 60, onCircle.v - 40)).toBeCloseTo(10, 12);
  });

  it('aligns with the anchor and with other points', () => {
    const anchored = snapCursor(sketch, positions, 45, 10.4, { ...options, anchor: [40, 25] });
    // Aligned horizontally with point a/b (not the anchor): an inference line, no relation.
    expect(anchored).toMatchObject({ u: 45, v: 10, target: { kind: 'none' } });
    expect(anchored.alignments).toEqual([{ axis: 'horizontal', from: [10, 10], anchor: false }]);
    const withAnchor = snapCursor(sketch, positions, 80, 25.3, { ...options, anchor: [40, 25] });
    expect(withAnchor.v).toBe(25);
    expect(withAnchor.alignments[0]).toMatchObject({ axis: 'horizontal', anchor: true });
  });

  it('puts a point where the anchor alignment crosses a curve', () => {
    // Drawing from (15, 30) straight down onto the line a–b.
    const crossing = snapCursor(sketch, positions, 15.3, 10.6, { ...options, anchor: [15, 30] });
    expect(crossing).toMatchObject({ u: 15, v: 10, target: { kind: 'curve', curve: 'l' } });
    expect(crossing.alignments).toEqual([{ axis: 'vertical', from: [15, 30], anchor: true }]);
    // Ending exactly above an existing point also keeps the line vertical.
    expect(snapCursor(sketch, positions, 10.2, 9.8, { ...options, anchor: [10, 50] }).alignments).toEqual([{ axis: 'vertical', from: [10, 50], anchor: true }]);
  });
});

describe('sketch builder', () => {
  it('creates readable unique ids and reuses snapped points', () => {
    const base: SketchData = { entities: [{ id: 'p7', type: 'point', x: 0, y: 0 }], constraints: [{ id: 'r2', type: 'fix', point: 'p7' }] };
    const builder = new SketchBuilder(base);
    const a = builder.point({ u: 1, v: 1, target: { kind: 'none' } });
    const b = builder.point({ u: 0, v: 0, target: { kind: 'point', id: 'p7' } });
    const line = builder.line(a, b);
    const relation = builder.relation({ type: 'horizontal', line });
    expect([a, b, line, relation]).toEqual(['p8', 'p7', 'l1', 'r3']);
    expect(new SketchBuilder(base).build()).toBe(base);
  });
});

describe('line tool', () => {
  it('draws a closed chain with shared corners, horizontal and vertical relations and the origin', () => {
    const tool = createTool('line');
    const sketch = draw(tool, [[0.3, 0.2], [40, 0.4], [40, 20], [0.2, 20], [0, 0]]);
    const lines = sketch.entities.filter((e) => e.type === 'line');
    const points = sketch.entities.filter((e) => e.type === 'point');
    expect(lines).toHaveLength(4);
    // Four corners, one of them the sketch origin itself.
    expect(points).toHaveLength(3);
    expect(lines[0]).toMatchObject({ p1: ORIGIN_ID });
    expect(lines[3]).toMatchObject({ p2: ORIGIN_ID });
    expect(types(sketch)).toEqual(['horizontal', 'horizontal', 'vertical', 'vertical']);
    expect(tool.busy).toBe(false);
    expectConsistent(sketch);
  });

  it('ends a chain with Esc or a second click on the same spot, and draws construction lines as centerlines', () => {
    const tool = createTool('line');
    let sketch = draw(tool, [[5, 5], [25, 12]]);
    expect(tool.busy).toBe(true);
    expect(tool.cancel()).toBe(true);
    expect(tool.cancel()).toBe(false);
    sketch = draw(tool, [[50, 50], [60, 70], [60, 70]], sketch);
    expect(tool.busy).toBe(false);
    expect(sketch.entities.filter((e) => e.type === 'line')).toHaveLength(2);
    const centerline = draw(createTool('centerline'), [[0, 30], [50, 30]], sketch);
    expect(centerline.entities.at(-1)).toMatchObject({ type: 'line', construction: true });
  });

  it('connects to midpoints and curves with relations', () => {
    const base = draw(createTool('line'), [[10, 10], [30, 10]]);
    const tool = createTool('line');
    const sketch = draw(tool, [[20.2, 10.3], [20.1, 40]], base);
    expect(types(sketch)).toEqual(['horizontal', 'midpoint', 'vertical']);
    expectConsistent(sketch);
  });
});

describe('rectangle tools', () => {
  it('draws a corner rectangle with four relations', () => {
    const sketch = draw(createTool('cornerRectangle'), [[5, 5], [45, 25]]);
    expect(sketch.entities.filter((e) => e.type === 'line')).toHaveLength(4);
    expect(types(sketch)).toEqual(['horizontal', 'horizontal', 'vertical', 'vertical']);
    expectConsistent(sketch);
  });

  it('draws a center rectangle around the origin with construction diagonals', () => {
    const sketch = draw(createTool('centerRectangle'), [[0.2, -0.1], [30, 20]]);
    const lines = sketch.entities.filter((e) => e.type === 'line');
    expect(lines).toHaveLength(6);
    expect(lines.filter((line) => line.construction)).toHaveLength(2);
    expect(sketch.constraints.find((c) => c.type === 'midpoint')).toMatchObject({ point: ORIGIN_ID });
    const xs = sketch.entities.flatMap((e) => (e.type === 'point' ? [e.x] : [])).sort((a, b) => a - b);
    expect(xs).toEqual([-30, -30, 30, 30]);
    expectConsistent(sketch);
  });

  it('draws a rectangle at an angle from one side and its width', () => {
    // One side from (0, 0) to (30, 40), the cursor 10 to the left of it (plus a bit along the side).
    const sketch = draw(createTool('threePointRectangle'), [[10, 10], [40, 50], [40 - 8 + 3, 50 + 6 + 4]]);
    const lines = sketch.entities.filter((e) => e.type === 'line');
    expect(lines).toHaveLength(4);
    expect(types(sketch)).toEqual(['parallel', 'parallel', 'perpendicular']);
    const corners = sketch.entities.flatMap((e) => (e.type === 'point' ? [[e.x, e.y]] : []));
    expect(corners).toEqual([
      [10, 10],
      [40, 50],
      [expect.closeTo(32), expect.closeTo(56)],
      [expect.closeTo(2), expect.closeTo(16)],
    ]);
    expectConsistent(sketch);
  });

  it('keeps the first side of an angled rectangle horizontal when it was drawn so', () => {
    const sketch = draw(createTool('threePointRectangle'), [[0, 0], [40, 0.1], [35, 15]]);
    expect(types(sketch)).toEqual(['horizontal', 'parallel', 'parallel', 'perpendicular']);
    expectConsistent(sketch);
  });

  it('draws a parallelogram from three corners; the third snaps', () => {
    const base = draw(createTool('point'), [[50, 20]]);
    const sketch = draw(createTool('parallelogram'), [[0, 0], [40, 0.1], [50.2, 20.1]], base);
    expect(types(sketch)).toEqual(['horizontal', 'parallel', 'parallel']);
    const corners = sketch.entities.flatMap((e) => (e.type === 'point' ? [[e.id, e.x, e.y]] : []));
    // The clicked point is reused as the third corner; the fourth completes the parallelogram.
    expect(corners).toEqual([
      ['p1', 50, 20],
      ['p2', 40, 0],
      ['p3', expect.closeTo(10), expect.closeTo(20)],
    ]);
    expectConsistent(sketch);
  });

  it('ignores flat parallelograms', () => {
    const tool = createTool('parallelogram');
    expect(draw(tool, [[0, 0], [40, 0], [80, 0.05]])).toBe(EMPTY);
    expect(tool.busy).toBe(true);
  });

  it('ignores degenerate rectangles', () => {
    const tool = createTool('cornerRectangle');
    expect(draw(tool, [[5, 5], [45, 5.1]])).toBe(EMPTY);
    expect(tool.busy).toBe(true);
  });
});

describe('circle and arc tools', () => {
  it('draws a circle through an existing point', () => {
    const base = draw(createTool('point'), [[30, 0]]);
    const sketch = draw(createTool('circle'), [[0, 0], [30.3, 0.2]], base);
    const circle = sketch.entities.find((e) => e.type === 'circle');
    expect(circle).toMatchObject({ center: ORIGIN_ID, radius: 30 });
    expect(types(sketch)).toEqual(['pointOnCircle']);
    expectConsistent(sketch);
  });

  it('draws center arcs in the direction the mouse moved', () => {
    const tool = createTool('centerArc');
    let sketch = draw(tool, [[50, 50], [70, 50]]);
    // Move clockwise from the start (downwards) and click a quarter turn later.
    for (const angle of [-0.3, -0.8, -1.2, -1.5]) tool.hover(sketch, event(50 + 20 * Math.cos(angle), 50 + 20 * Math.sin(angle)));
    sketch = tool.click(sketch, event(50, 30)).commit ?? sketch;
    const arc = sketch.entities.find((e) => e.type === 'arc');
    const position = (id: string) => sketch.entities.find((e) => e.id === id) as { x: number; y: number };
    if (arc?.type !== 'arc') throw new Error('no arc');
    // Stored counterclockwise: from the clicked end (bottom) to the start (right).
    expect(position(arc.start)).toMatchObject({ x: 50, y: 30 });
    expect(position(arc.end)).toMatchObject({ x: 70, y: 50 });
    expectConsistent(sketch);
  });

  it('draws three-point arcs through the third point', () => {
    expect(circumcenter([0, 0], [2, 0], [1, 1])).toEqual([1, 0]);
    expect(circumcenter([0, 0], [1, 0], [2, 0])).toBeNull();
    const below = draw(createTool('threePointArc'), [[-10, 20], [10, 20], [0, 10]]);
    const arc = below.entities.find((e) => e.type === 'arc');
    if (arc?.type !== 'arc') throw new Error('no arc');
    const center = below.entities.find((e) => e.id === arc.center) as { x: number; y: number };
    expect(center.x).toBeCloseTo(0, 9);
    expect(center.y).toBeCloseTo(20, 9);
    // Counterclockwise from the left point through the bottom to the right point.
    expect((below.entities.find((e) => e.id === arc.start) as { x: number }).x).toBe(-10);
    expectConsistent(below);
  });
});

describe('point tool', () => {
  it('places points with relations and never duplicates an existing point', () => {
    const base = draw(createTool('line'), [[10, 10], [30, 10]]);
    const onLine = draw(createTool('point'), [[15, 10.3], [20, 10.2], [10, 10]], base);
    expect(types(onLine)).toEqual(['horizontal', 'midpoint', 'pointOnLine']);
    expect(onLine.entities.filter((e) => e.type === 'point')).toHaveLength(4);
    expectConsistent(onLine);
  });
});

describe('tangent arcs', () => {
  it('continue a line tangentially from its end point', () => {
    const line = draw(createTool('line'), [[0, 0], [30, 0]]);
    const sketch = draw(createTool('tangentArc'), [[30, 0], [40, 10]], line);
    const arc = sketch.entities.find((e) => e.type === 'arc');
    if (arc?.type !== 'arc') throw new Error('no arc');
    const center = sketch.entities.find((e) => e.id === arc.center) as { x: number; y: number };
    // Leaving (30, 0) to the right and ending up at (40, 10): a quarter circle around (30, 10).
    expect(center.x).toBeCloseTo(30, 9);
    expect(center.y).toBeCloseTo(10, 9);
    expect(sketch.constraints.find((c) => c.type === 'tangent')).toMatchObject({ a: 'l1', b: arc.id });
    expectConsistent(sketch);
  });

  it('only start at the end of a curve, and mark arcs that touch from inside', () => {
    const tool = createTool('tangentArc');
    tool.click(EMPTY, event(5, 5));
    expect(tool.busy).toBe(false);
    // An arc from (10, 0) around the origin to (0, 10), continued by a smaller arc curving the same way.
    const base = draw(createTool('centerArc'), [[0, 0], [10, 0], [0, 10]]);
    const tangent = draw(createTool('tangentArc'), [[0, 10], [-5, 5]], base);
    const relation = tangent.constraints.find((c) => c.type === 'tangent');
    expect(relation).toMatchObject({ inner: true });
    expectConsistent(tangent);
  });
});

describe('three-point circles, slots and polygons', () => {
  it('draws a circle through three points, keeping existing points on it', () => {
    const base = draw(createTool('point'), [[10, 0]]);
    const sketch = draw(createTool('threePointCircle'), [[10, 0], [0, 10], [-10, 0]], base);
    expect(sketch.entities.find((e) => e.type === 'circle')).toMatchObject({ radius: 10 });
    expect(types(sketch)).toEqual(['pointOnCircle']);
    expectConsistent(sketch);
  });

  it('draws a slot of tangent lines and equal arcs around a construction axis', () => {
    const sketch = draw(createTool('slot'), [[0, 0], [40, 0.2], [20, 8]]);
    expect(sketch.entities.filter((e) => e.type === 'line' && !e.construction)).toHaveLength(2);
    expect(sketch.entities.filter((e) => e.type === 'arc')).toHaveLength(2);
    expect(types(sketch)).toEqual(['equal', 'horizontal', 'tangent', 'tangent', 'tangent', 'tangent']);
    const arc = sketch.entities.find((e) => e.type === 'arc');
    if (arc?.type !== 'arc') throw new Error('no arc');
    const [center, start] = [arc.center, arc.start].map((id) => sketch.entities.find((e) => e.id === id) as { x: number; y: number });
    expect(Math.hypot((start?.x ?? 0) - (center?.x ?? 0), (start?.y ?? 0) - (center?.y ?? 0))).toBeCloseTo(8, 9);
    expectConsistent(sketch);
  });

  it('draws regular polygons with the chosen number of sides', () => {
    const sketch = draw(createTool('polygon', { ...DEFAULT_TOOL_OPTIONS, polygonSides: 6 }), [[0, 0], [20, 0.3]]);
    const sides = sketch.entities.filter((e) => e.type === 'line');
    expect(sides).toHaveLength(6);
    expect(sketch.entities.find((e) => e.type === 'circle')).toMatchObject({ construction: true, radius: 20 });
    expect(types(sketch).filter((t) => t === 'equal')).toHaveLength(5);
    expect(types(sketch).filter((t) => t === 'pointOnCircle')).toHaveLength(6);
    expect(types(sketch)).toContain('horizontalPoints');
    expectConsistent(sketch);
    expect(draw(createTool('polygon', { ...DEFAULT_TOOL_OPTIONS, polygonSides: 1 }), [[0, 0], [10, 3]]).entities.filter((e) => e.type === 'line')).toHaveLength(3);
  });
});
