import { describe, expect, it } from 'vitest';
import { chainsOf, offsetSelection } from '../../src/renderer/src/sketch/offset.ts';
import { createTool, type ToolEvent } from '../../src/renderer/src/sketch/tools.ts';
import type { SketchArc, SketchData, SketchEntity, SketchLine } from '../../src/shared/model/sketch.ts';
import { parseSketchData } from '../../src/shared/model/validate-sketch.ts';
import { solveSketch } from '../../src/sketch/solver/index.ts';

const point = (id: string, x: number, y: number) => ({ id, type: 'point' as const, x, y });
const event = (u: number, v: number): ToolEvent => ({ u, v, tolerance: 1, alignTolerance: 0.6 });

/** A counterclockwise 40 × 20 rectangle. */
const rectangle: SketchData = {
  entities: [
    point('a', 0, 0),
    point('b', 40, 0),
    point('c', 40, 20),
    point('d', 0, 20),
    { id: 'l1', type: 'line', p1: 'a', p2: 'b' },
    { id: 'l2', type: 'line', p1: 'b', p2: 'c' },
    { id: 'l3', type: 'line', p1: 'c', p2: 'd' },
    { id: 'l4', type: 'line', p1: 'd', p2: 'a' },
  ],
  constraints: [],
};

function consistent(result: SketchData): void {
  expect(() => parseSketchData(JSON.parse(JSON.stringify(result)))).not.toThrow();
  const solution = solveSketch(result);
  expect(solution.converged).toBe(true);
  for (const entity of result.entities) {
    const solved = solution.sketch.entities.find((e) => e.id === entity.id) as SketchEntity;
    if (entity.type === 'point' && solved.type === 'point') {
      expect(solved.x).toBeCloseTo(entity.x, 6);
      expect(solved.y).toBeCloseTo(entity.y, 6);
    }
  }
}

const newPoints = (base: SketchData, result: SketchData) =>
  result.entities
    .slice(base.entities.length)
    .filter((e) => e.type === 'point')
    .map((p) => (p.type === 'point' ? [Math.round(p.x * 1e6) / 1e6, Math.round(p.y * 1e6) / 1e6] : []));

describe('chains', () => {
  it('orders connected curves end to end and recognizes closed loops', () => {
    const lines = rectangle.entities.filter((e): e is SketchLine => e.type === 'line');
    const [chain] = chainsOf([lines[2] as SketchLine, lines[0] as SketchLine, lines[1] as SketchLine, lines[3] as SketchLine]);
    expect(chain?.closed).toBe(true);
    expect(chain?.steps.map((s) => s.curve.id)).toHaveLength(4);
    expect(chainsOf(lines.slice(0, 2))[0]?.closed).toBe(false);
  });
});

describe('offset', () => {
  it('offsets a closed rectangle outwards, or inwards when flipped, with sharp corners', () => {
    const inside = offsetSelection(rectangle, ['l1', 'l2', 'l3', 'l4'], 5, true);
    if (!inside.ok) throw new Error(inside.error);
    expect(newPoints(rectangle, inside.sketch).sort()).toEqual(
      [
        [5, 5],
        [35, 5],
        [35, 15],
        [5, 15],
      ].sort(),
    );
    expect(inside.sketch.constraints.filter((c) => c.type === 'parallel')).toHaveLength(4);
    expect(inside.sketch.constraints.filter((c) => c.type === 'distance')).toHaveLength(1);
    consistent(inside.sketch);
    const outside = offsetSelection(rectangle, ['l1', 'l2', 'l3', 'l4'], 5);
    if (!outside.ok) throw new Error(outside.error);
    expect(newPoints(rectangle, outside.sketch).sort()).toContainEqual([-5, -5]);
    consistent(outside.sketch);
  });

  it('keeps tangent chains of lines and arcs connected, with the arcs on the original centers', () => {
    let slot: SketchData = { entities: [], constraints: [] };
    const tool = createTool('slot');
    for (const [u, v] of [[0, 0], [40, 0], [20, 8]] as const) slot = tool.click(slot, event(u, v)).commit ?? slot;
    const outline = slot.entities.filter((e) => (e.type === 'line' && !e.construction) || e.type === 'arc').map((e) => e.id);
    const result = offsetSelection(slot, outline, 3);
    if (!result.ok) throw new Error(result.error);
    const arcs = result.sketch.entities.slice(slot.entities.length).filter((e): e is SketchArc => e.type === 'arc');
    expect(arcs).toHaveLength(2);
    for (const arc of arcs) {
      const at = (id: string) => (id === 'origin' ? { x: 0, y: 0 } : (result.sketch.entities.find((e) => e.id === id) as { x: number; y: number }));
      const [c, s] = [at(arc.center), at(arc.start)];
      expect(Math.hypot(s.x - c.x, s.y - c.y)).toBeCloseTo(11, 6);
    }
    consistent(result.sketch);
  });

  it('offsets circles concentrically and refuses distances that do not fit', () => {
    const circle: SketchData = { entities: [point('m', 0, 0), { id: 'k', type: 'circle', center: 'm', radius: 10 }], constraints: [] };
    const bigger = offsetSelection(circle, ['k'], 4);
    expect(bigger.ok && bigger.sketch.entities.at(-1)).toMatchObject({ type: 'circle', center: 'm', radius: 14 });
    expect(offsetSelection(circle, ['k'], 12, true)).toEqual({ ok: false, error: 'too-large' });
    expect(offsetSelection(circle, [], 2)).toEqual({ ok: false, error: 'nothing-selected' });
  });
});
