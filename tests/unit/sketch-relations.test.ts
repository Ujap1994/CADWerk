import { describe, expect, it } from 'vitest';
import { applicableRelations, relationKindOf, relationsOf } from '../../src/renderer/src/sketch/relations.ts';
import { ORIGIN_ID, type SketchData } from '../../src/shared/model/sketch.ts';

const point = (id: string, x: number, y: number) => ({ id, type: 'point' as const, x, y });

const sketch: SketchData = {
  entities: [
    point('a', 0, 0),
    point('b', 50, 5),
    point('c', 60, 40),
    point('d', 10, 30),
    { id: 'l1', type: 'line', p1: 'a', p2: 'b' },
    { id: 'l2', type: 'line', p1: 'c', p2: 'd' },
    { id: 'l3', type: 'line', p1: 'b', p2: 'c' },
    point('m', 100, 0),
    { id: 'k1', type: 'circle', center: 'm', radius: 10 },
    point('n', 140, 0),
    { id: 'k2', type: 'circle', center: 'n', radius: 12 },
    point('free', 20, 60),
  ],
  constraints: [
    { id: 'h', type: 'horizontal', line: 'l1' },
    { id: 'dim', type: 'distance', a: 'a', b: 'b', value: 50, driving: true },
    { id: 'on', type: 'pointOnLine', point: 'free', line: 'l2' },
  ],
};

const kinds = (ids: string[]) => applicableRelations(sketch, ids).map((option) => option.kind);

describe('applicable relations', () => {
  it('offers what fits the selection', () => {
    expect(kinds(['l1'])).toEqual(['horizontal', 'vertical']);
    expect(kinds(['l1', 'l2'])).toEqual(['horizontal', 'vertical', 'parallel', 'perpendicular', 'collinear', 'equal']);
    expect(kinds(['a', 'c'])).toEqual(['horizontal', 'vertical', 'coincident', 'fix']);
    expect(kinds(['free', 'l1'])).toEqual(['onCurve', 'midpoint']);
    expect(kinds(['free', 'k1'])).toEqual(['onCurve']);
    expect(kinds(['k1', 'k2'])).toEqual(['equal', 'tangent', 'concentric']);
    expect(kinds(['l3', 'k1'])).toEqual(['tangent']);
    expect(kinds(['a', 'c', 'l2'])).toEqual(['symmetric']);
    expect(kinds([])).toEqual([]);
  });

  it('applies to every selected line and treats the origin as a point that cannot be fixed', () => {
    const horizontal = applicableRelations(sketch, ['l1', 'l2', 'l3']).find((option) => option.kind === 'horizontal');
    expect(horizontal?.relations).toEqual([
      { type: 'horizontal', line: 'l1' },
      { type: 'horizontal', line: 'l2' },
      { type: 'horizontal', line: 'l3' },
    ]);
    const equal = applicableRelations(sketch, ['l1', 'l2', 'l3']).find((option) => option.kind === 'equal');
    expect(equal?.relations).toHaveLength(2);
    expect(kinds([ORIGIN_ID, 'c'])).toEqual(['horizontal', 'vertical', 'coincident', 'fix']);
    expect(applicableRelations(sketch, [ORIGIN_ID, 'c']).find((option) => option.kind === 'fix')?.relations).toEqual([{ type: 'fix', point: 'c' }]);
    expect(kinds([ORIGIN_ID])).toEqual([]);
  });
});

describe('existing relations', () => {
  it('lists the relations of selected entities and names them', () => {
    expect(relationsOf(sketch, ['l1']).map((c) => c.id)).toEqual(['h']);
    expect(relationsOf(sketch, ['free', 'a']).map((c) => c.id)).toEqual(['on']);
    expect(sketch.constraints.map(relationKindOf)).toEqual(['horizontal', null, 'onCurve']);
  });
});
