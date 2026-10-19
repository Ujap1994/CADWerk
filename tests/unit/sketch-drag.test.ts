import { describe, expect, it } from 'vitest';
import { dragTarget, sameGeometry } from '../../src/renderer/src/sketch/drag.ts';
import type { SketchData } from '../../src/shared/model/sketch.ts';

const point = (id: string, x: number, y: number) => ({ id, type: 'point' as const, x, y });

const sketch: SketchData = {
  entities: [
    point('a', 0, 0),
    point('b', 50, 0),
    { id: 'l', type: 'line', p1: 'a', p2: 'b' },
    point('c', 100, 0),
    { id: 'k', type: 'circle', center: 'c', radius: 10 },
    point('ac', 0, 100),
    point('as', 20, 100),
    point('ae', 0, 120),
    { id: 'arc', type: 'arc', center: 'ac', start: 'as', end: 'ae' },
  ],
  constraints: [],
};

describe('drag targets', () => {
  it('moves a grabbed point by the cursor movement, without jumping to the cursor', () => {
    const target = dragTarget(sketch, { id: 'b', type: 'point', distance: 1 }, { u: 51, v: 1 }, { u: 61, v: 6 });
    expect(target).toEqual({ kind: 'point', id: 'b', x: 60, y: 5 });
  });

  it('moves lines and arcs as a whole', () => {
    expect(dragTarget(sketch, { id: 'l', type: 'line', distance: 0 }, { u: 25, v: 0 }, { u: 30, v: -2 })).toEqual({
      kind: 'points',
      points: [
        { id: 'a', x: 5, y: -2 },
        { id: 'b', x: 55, y: -2 },
      ],
    });
    const arc = dragTarget(sketch, { id: 'arc', type: 'arc', distance: 0 }, { u: 14, v: 114 }, { u: 15, v: 116 });
    expect(arc).toEqual({
      kind: 'points',
      points: [
        { id: 'ac', x: 1, y: 102 },
        { id: 'as', x: 21, y: 102 },
        { id: 'ae', x: 1, y: 122 },
      ],
    });
  });

  it('changes the radius of a circle grabbed at its edge by the radial movement', () => {
    const target = dragTarget(sketch, { id: 'k', type: 'circle', distance: 0.5 }, { u: 110.5, v: 0 }, { u: 115.5, v: 0 });
    expect(target?.kind).toBe('radius');
    expect(target?.kind === 'radius' && target.radius).toBeCloseTo(15, 12);
    // Dragging across the center never makes the radius negative.
    const collapsed = dragTarget(sketch, { id: 'k', type: 'circle', distance: 0 }, { u: 110, v: 0 }, { u: 100, v: 0 });
    expect(collapsed?.kind === 'radius' && collapsed.radius).toBeGreaterThan(0);
  });

  it('ignores unknown entities', () => {
    expect(dragTarget(sketch, { id: 'gone', type: 'line', distance: 0 }, { u: 0, v: 0 }, { u: 1, v: 1 })).toBeNull();
  });
});

describe('geometry comparison', () => {
  it('detects moved points and changed radii, ignoring floating-point noise', () => {
    const moved: SketchData = { ...sketch, entities: sketch.entities.map((e) => (e.id === 'a' ? { ...e, x: 1e-12 } : e)) };
    expect(sameGeometry(sketch, moved)).toBe(true);
    const really: SketchData = { ...sketch, entities: sketch.entities.map((e) => (e.id === 'a' ? { ...e, x: 0.001 } : e)) };
    expect(sameGeometry(sketch, really)).toBe(false);
    const bigger: SketchData = { ...sketch, entities: sketch.entities.map((e) => (e.id === 'k' ? { ...e, radius: 11 } : e)) };
    expect(sameGeometry(sketch, bigger)).toBe(false);
    expect(sameGeometry(sketch, { ...sketch, entities: sketch.entities.slice(1) })).toBe(false);
  });
});
