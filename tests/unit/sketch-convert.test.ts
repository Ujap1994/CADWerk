import { describe, expect, it } from 'vitest';
import type { EdgeInfo } from '../../src/kernel/protocol.ts';
import { convertEdges, type ModelEdge } from '../../src/renderer/src/sketch/convert.ts';
import { ellipseOf, pointPositions } from '../../src/renderer/src/sketch/geometry.ts';
import { STANDARD_FRAMES, type SketchData, type SketchEllipse } from '../../src/shared/model/sketch.ts';
import { parseSketchData } from '../../src/shared/model/validate-sketch.ts';
import type { Vec3 } from '../../src/shared/model/feature.ts';
import { solveSketch } from '../../src/sketch/solver/index.ts';

const EMPTY: SketchData = { entities: [], constraints: [] };
const top = STANDARD_FRAMES.top;

const line = (start: Vec3, end: Vec3): ModelEdge => ({
  info: { kind: 'line', length: Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]), start, end },
  polyline: new Float32Array([...start, ...end]),
});

/** A circle or arc around `axis` from `from` (radians, measured in the circle's own frame) over `sweep`. */
function circle(center: Vec3, radius: number, axis: Vec3, from = 0, sweep = 2 * Math.PI): ModelEdge {
  // Frame of the circle: u, w perpendicular to the axis (axis is a unit vector here).
  const helper: Vec3 = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a: Vec3): Vec3 => {
    const l = Math.hypot(...a);
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const u = unit(cross(helper, axis));
  const w = cross(axis, u);
  const at = (t: number): Vec3 => [0, 1, 2].map((k) => (center[k] as number) + radius * (Math.cos(t) * (u[k] as number) + Math.sin(t) * (w[k] as number))) as Vec3;
  const points: number[] = [];
  for (let i = 0; i < 32; i++) points.push(...at(from + (sweep * i) / 32), ...at(from + (sweep * (i + 1)) / 32));
  const info: EdgeInfo = { kind: 'circle', length: radius * sweep, radius, start: at(from), end: at(from + sweep), center, axis };
  return { info, polyline: new Float32Array(points) };
}

const convert = (edges: ModelEdge[], base = EMPTY) => {
  const result = convertEdges(base, top, edges);
  if (!result.ok) throw new Error(result.error);
  expect(() => parseSketchData(JSON.parse(JSON.stringify(result.sketch)))).not.toThrow();
  return result.sketch;
};

describe('convert entities', () => {
  it('projects the edges of a face into a closed, fixed outline', () => {
    // The top face of a box, 10 mm above the sketch plane.
    const sketch = convert([line([0, 0, 10], [40, 0, 10]), line([40, 0, 10], [40, 20, 10]), line([40, 20, 10], [0, 20, 10]), line([0, 20, 10], [0, 0, 10])]);
    expect(sketch.entities.filter((e) => e.type === 'line')).toHaveLength(4);
    // Shared corners: three points plus the origin, every new point fixed once.
    expect(sketch.entities.filter((e) => e.type === 'point')).toHaveLength(3);
    expect(sketch.constraints.filter((c) => c.type === 'fix')).toHaveLength(3);
    expect(solveSketch(sketch).status?.sketch).toBe('full');
  });

  it('turns circles and arcs parallel to the sketch into circles and arcs, in the right direction', () => {
    const sketch = convert([circle([10, 5, -3], 4, [0, 0, 1]), circle([30, 0, 0], 5, [0, 0, -1], 0, Math.PI / 2)]);
    const round = sketch.entities.find((e) => e.type === 'circle');
    expect(round).toMatchObject({ radius: 4 });
    expect(solveSketch(sketch).status?.sketch).toBe('full');
    // Seen from above, the arc around -Z runs clockwise from (30, 5) to (35, 0); sketch arcs run
    // counterclockwise, so it starts at (35, 0).
    const arc = sketch.entities.find((e) => e.type === 'arc');
    if (arc?.type !== 'arc') throw new Error('no arc');
    const positions = pointPositions(sketch);
    expect(positions.get(arc.start)).toEqual([expect.closeTo(35, 6), expect.closeTo(0, 6)]);
    expect(positions.get(arc.end)).toEqual([expect.closeTo(30, 6), expect.closeTo(5, 6)]);
  });

  it('turns a tilted circle into an ellipse', () => {
    // A circle of radius 10 tilted by 60° around the x axis: 10 across, 5 along the tilt.
    const axis: Vec3 = [0, -Math.sin(Math.PI / 3), Math.cos(Math.PI / 3)];
    const sketch = convert([circle([0, 0, 5], 10, axis)]);
    const ellipse = sketch.entities.find((e) => e.type === 'ellipse') as SketchEllipse;
    const geometry = ellipseOf(ellipse, pointPositions(sketch));
    expect(geometry?.a).toBeCloseTo(10, 9);
    expect(geometry?.b).toBeCloseTo(5, 9);
    expect(Math.abs(geometry?.axis[0] ?? 0)).toBeCloseTo(1, 9);
  });

  it('skips edges perpendicular to the sketch and does not stack repeated conversions', () => {
    expect(convertEdges(EMPTY, top, [line([5, 5, 0], [5, 5, 20])])).toEqual({ ok: false, error: 'nothing-to-convert' });
    const once = convert([line([0, 0, 0], [10, 0, 0])]);
    expect(convertEdges(once, top, [line([10, 0, 0], [0, 0, 0])])).toEqual({ ok: false, error: 'already-converted' });
  });

  it('turns other curves into splines through points of the edge', () => {
    const points: number[] = [];
    for (let i = 0; i < 100; i++) {
      const p = (k: number): Vec3 => [k, 0.01 * k * k, 3];
      points.push(...p(i), ...p(i + 1));
    }
    const sketch = convert([{ info: { kind: 'bspline', length: 120 }, polyline: new Float32Array(points) }]);
    const spline = sketch.entities.find((e) => e.type === 'spline');
    if (spline?.type !== 'spline') throw new Error('no spline');
    expect(spline.points.length).toBeLessThanOrEqual(48);
    const positions = pointPositions(sketch);
    expect(positions.get(spline.points.at(-1) as string)).toEqual([100, 100]);
  });
});
