/**
 * Which relations can be added to a selection of sketch geometry, and what they become.
 * The same relation names are used for the buttons, the relation list and the tool hints.
 */

import { isDimension, ORIGIN_ID, type SketchConstraint, type SketchData, type SketchRelation } from '../../../shared/model/sketch.ts';
import { constraintReferences } from './geometry.ts';

export type RelationKind =
  | 'horizontal'
  | 'vertical'
  | 'coincident'
  | 'onCurve'
  | 'midpoint'
  | 'parallel'
  | 'perpendicular'
  | 'collinear'
  | 'equal'
  | 'tangent'
  | 'concentric'
  | 'symmetric'
  | 'fix';

export const RELATION_KINDS: readonly RelationKind[] = [
  'horizontal',
  'vertical',
  'coincident',
  'onCurve',
  'midpoint',
  'parallel',
  'perpendicular',
  'collinear',
  'equal',
  'tangent',
  'concentric',
  'symmetric',
  'fix',
];

export type RelationInput = SketchRelation extends infer R ? (R extends SketchRelation ? Omit<R, 'id'> : never) : never;

export interface RelationOption {
  kind: RelationKind;
  /** The relations to add (several for e.g. "horizontal" on three lines). */
  relations: RelationInput[];
}

/** The relation kind a stored constraint is shown as (horizontal points read as "horizontal", ...). */
export function relationKindOf(constraint: SketchConstraint): RelationKind | null {
  if (isDimension(constraint)) return null;
  switch (constraint.type) {
    case 'horizontalPoints':
      return 'horizontal';
    case 'verticalPoints':
      return 'vertical';
    case 'pointOnLine':
    case 'pointOnCircle':
      return 'onCurve';
    default:
      return constraint.type;
  }
}

interface Classified {
  points: string[];
  lines: string[];
  rounds: string[];
  ellipses: string[];
}

function classify(sketch: SketchData, ids: readonly string[]): Classified {
  const types = new Map(sketch.entities.map((entity) => [entity.id, entity.type]));
  types.set(ORIGIN_ID, 'point');
  const result: Classified = { points: [], lines: [], rounds: [], ellipses: [] };
  for (const id of ids) {
    const type = types.get(id);
    if (type === 'point') result.points.push(id);
    else if (type === 'line') result.lines.push(id);
    else if (type === 'circle' || type === 'arc') result.rounds.push(id);
    else if (type === 'ellipse') result.ellipses.push(id);
  }
  return result;
}

/** The relations that make sense for the selected entities, in a stable order. */
export function applicableRelations(sketch: SketchData, ids: readonly string[]): RelationOption[] {
  const { points, lines, rounds, ellipses } = classify(sketch, ids);
  const [p0, p1] = points as [string | undefined, string | undefined];
  const [l0, l1] = lines as [string | undefined, string | undefined];
  const [r0, r1] = rounds as [string | undefined, string | undefined];
  const [e0] = ellipses as [string | undefined];
  const noEllipse = ellipses.length === 0;
  const onlyLines = lines.length > 0 && points.length === 0 && rounds.length === 0 && noEllipse;
  const onlyPoints = points.length > 0 && lines.length === 0 && rounds.length === 0 && noEllipse;
  const onlyRounds = rounds.length > 0 && points.length === 0 && lines.length === 0 && noEllipse;
  const pairOf = (n: number, list: string[]) => list.length === n;
  const options: RelationOption[] = [];
  const add = (kind: RelationKind, relations: RelationInput[]) => {
    if (relations.length > 0) options.push({ kind, relations });
  };

  if (onlyLines) {
    add('horizontal', lines.map((line) => ({ type: 'horizontal', line })));
    add('vertical', lines.map((line) => ({ type: 'vertical', line })));
  }
  if (onlyPoints && pairOf(2, points) && p0 && p1) {
    add('horizontal', [{ type: 'horizontalPoints', a: p0, b: p1 }]);
    add('vertical', [{ type: 'verticalPoints', a: p0, b: p1 }]);
    add('coincident', [{ type: 'coincident', a: p0, b: p1 }]);
  }
  if (pairOf(1, points) && pairOf(1, lines) && rounds.length === 0 && p0 && l0) {
    add('onCurve', [{ type: 'pointOnLine', point: p0, line: l0 }]);
    add('midpoint', [{ type: 'midpoint', point: p0, line: l0 }]);
  }
  if (pairOf(1, points) && pairOf(1, rounds) && lines.length === 0 && noEllipse && p0 && r0) {
    add('onCurve', [{ type: 'pointOnCircle', point: p0, circle: r0 }]);
  }
  // Ellipses: a point on them, a line tangent to them.
  if (pairOf(1, ellipses) && rounds.length === 0 && e0) {
    if (pairOf(1, points) && lines.length === 0 && p0) add('onCurve', [{ type: 'pointOnCircle', point: p0, circle: e0 }]);
    if (pairOf(1, lines) && points.length === 0 && l0) add('tangent', [{ type: 'tangent', a: l0, b: e0 }]);
  }
  if (onlyLines && pairOf(2, lines) && l0 && l1) {
    add('parallel', [{ type: 'parallel', a: l0, b: l1 }]);
    add('perpendicular', [{ type: 'perpendicular', a: l0, b: l1 }]);
    add('collinear', [{ type: 'collinear', a: l0, b: l1 }]);
  }
  if (onlyLines && lines.length >= 2 && l0) add('equal', lines.slice(1).map((line) => ({ type: 'equal', a: l0, b: line })));
  if (onlyRounds && rounds.length >= 2 && r0) add('equal', rounds.slice(1).map((round) => ({ type: 'equal', a: r0, b: round })));
  if (points.length === 0 && noEllipse && ((pairOf(1, lines) && pairOf(1, rounds)) || (lines.length === 0 && pairOf(2, rounds)))) {
    const a = (l0 ?? r0) as string;
    const b = (l0 ? r0 : r1) as string;
    add('tangent', [{ type: 'tangent', a, b }]);
  }
  if (onlyRounds && pairOf(2, rounds) && r0 && r1) add('concentric', [{ type: 'concentric', a: r0, b: r1 }]);
  if (pairOf(2, points) && pairOf(1, lines) && rounds.length === 0 && noEllipse && p0 && p1 && l0) add('symmetric', [{ type: 'symmetric', a: p0, b: p1, line: l0 }]);
  if (onlyPoints) add('fix', points.filter((point) => point !== ORIGIN_ID).map((point) => ({ type: 'fix', point })));
  return options;
}

/** Relations (not dimensions) that refer to any of the given entities. */
export function relationsOf(sketch: SketchData, ids: readonly string[]): SketchConstraint[] {
  const selected = new Set(ids);
  return sketch.constraints.filter((constraint) => !isDimension(constraint) && constraintReferences(constraint).some((id) => selected.has(id)));
}
