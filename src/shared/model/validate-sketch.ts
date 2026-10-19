import {
  DIMENSION_TYPES,
  MAX_SPLINE_POINTS,
  ORIGIN_ID,
  type SketchConstraint,
  type SketchData,
  type SketchEntity,
  type SketchFrame,
  type SketchPlaneRef,
} from './sketch.ts';
import { coordinate, isObject, positiveLength, ValidationError, vec3 } from './validate.ts';

/** Limits that keep a damaged or hostile file from exhausting memory. */
const MAX_ENTITIES = 100_000;
const MAX_CONSTRAINTS = 200_000;

function identifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) throw new ValidationError('expected an id', path);
  return value;
}

function flag(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new ValidationError('expected true or false', path);
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ValidationError('expected a finite number', path);
  return value;
}

function parseEntity(raw: unknown, path: string): SketchEntity {
  if (!isObject(raw)) throw new ValidationError('expected an object', path);
  const id = identifier(raw.id, `${path}.id`);
  const construction = flag(raw.construction, `${path}.construction`);
  const extra = construction === undefined ? {} : { construction };
  switch (raw.type) {
    case 'point':
      return { id, type: 'point', x: coordinate(raw.x, `${path}.x`), y: coordinate(raw.y, `${path}.y`), ...extra };
    case 'line':
      return { id, type: 'line', p1: identifier(raw.p1, `${path}.p1`), p2: identifier(raw.p2, `${path}.p2`), ...extra };
    case 'circle':
      return { id, type: 'circle', center: identifier(raw.center, `${path}.center`), radius: positiveLength(raw.radius, `${path}.radius`), ...extra };
    case 'arc':
      return {
        id,
        type: 'arc',
        center: identifier(raw.center, `${path}.center`),
        start: identifier(raw.start, `${path}.start`),
        end: identifier(raw.end, `${path}.end`),
        ...extra,
      };
    case 'spline': {
      if (!Array.isArray(raw.points) || raw.points.length < 2 || raw.points.length > MAX_SPLINE_POINTS) {
        throw new ValidationError(`expected 2 to ${MAX_SPLINE_POINTS} points`, `${path}.points`);
      }
      return { id, type: 'spline', points: raw.points.map((point, i) => identifier(point, `${path}.points[${i}]`)), ...extra };
    }
    case 'ellipse':
      return {
        id,
        type: 'ellipse',
        center: identifier(raw.center, `${path}.center`),
        major: identifier(raw.major, `${path}.major`),
        minor: identifier(raw.minor, `${path}.minor`),
        ...extra,
      };
    default:
      throw new ValidationError(`unknown sketch entity ${JSON.stringify(raw.type)}`, `${path}.type`);
  }
}

const REFERENCE_FIELDS = ['a', 'b', 'line', 'point', 'circle'] as const;

const CONSTRAINT_FIELDS: Record<string, readonly (typeof REFERENCE_FIELDS)[number][]> = {
  coincident: ['a', 'b'],
  horizontal: ['line'],
  vertical: ['line'],
  horizontalPoints: ['a', 'b'],
  verticalPoints: ['a', 'b'],
  parallel: ['a', 'b'],
  perpendicular: ['a', 'b'],
  collinear: ['a', 'b'],
  tangent: ['a', 'b'],
  equal: ['a', 'b'],
  concentric: ['a', 'b'],
  midpoint: ['point', 'line'],
  pointOnLine: ['point', 'line'],
  pointOnCircle: ['point', 'circle'],
  symmetric: ['a', 'b', 'line'],
  fix: ['point'],
  distance: ['a', 'b'],
  horizontalDistance: ['a', 'b'],
  verticalDistance: ['a', 'b'],
  radius: ['circle'],
  diameter: ['circle'],
  angle: ['a', 'b'],
};

function parseConstraint(raw: unknown, path: string): SketchConstraint {
  if (!isObject(raw)) throw new ValidationError('expected an object', path);
  const type = raw.type;
  if (typeof type !== 'string' || !(type in CONSTRAINT_FIELDS)) throw new ValidationError(`unknown constraint ${JSON.stringify(type)}`, `${path}.type`);
  const result: Record<string, unknown> = { id: identifier(raw.id, `${path}.id`), type };
  for (const field of CONSTRAINT_FIELDS[type] ?? []) result[field] = identifier(raw[field], `${path}.${field}`);
  if (type === 'tangent' && raw.inner !== undefined) result.inner = flag(raw.inner, `${path}.inner`);
  if (DIMENSION_TYPES.has(type as SketchConstraint['type'])) {
    const value = finite(raw.value, `${path}.value`);
    if (type !== 'angle' && value < 0) throw new ValidationError('expected a non-negative value', `${path}.value`);
    if (type === 'angle' && Math.abs(value) > 2 * Math.PI) throw new ValidationError('expected an angle in radians', `${path}.value`);
    result.value = value;
    result.driving = flag(raw.driving, `${path}.driving`) ?? true;
    if (raw.offset !== undefined) {
      if (!Array.isArray(raw.offset) || raw.offset.length !== 2) throw new ValidationError('expected [x, y]', `${path}.offset`);
      result.offset = [coordinate(raw.offset[0], `${path}.offset[0]`), coordinate(raw.offset[1], `${path}.offset[1]`)];
    }
  }
  return result as unknown as SketchConstraint;
}

/** Validates entities and constraints, including that every reference exists and has the right kind. */
export function parseSketchData(raw: unknown, path = 'sketch'): SketchData {
  if (!isObject(raw)) throw new ValidationError('expected an object', path);
  if (!Array.isArray(raw.entities) || raw.entities.length > MAX_ENTITIES) throw new ValidationError('expected a list of entities', `${path}.entities`);
  if (!Array.isArray(raw.constraints) || raw.constraints.length > MAX_CONSTRAINTS) throw new ValidationError('expected a list of constraints', `${path}.constraints`);
  const entities = raw.entities.map((entity, i) => parseEntity(entity, `${path}.entities[${i}]`));
  const constraints = raw.constraints.map((constraint, i) => parseConstraint(constraint, `${path}.constraints[${i}]`));

  const kinds = new Map<string, SketchEntity['type']>([[ORIGIN_ID, 'point']]);
  for (const entity of entities) {
    if (kinds.has(entity.id)) throw new ValidationError(`duplicate id ${entity.id}`, `${path}.entities`);
    kinds.set(entity.id, entity.type);
  }
  const expectPoint = (id: string, where: string) => {
    if (kinds.get(id) !== 'point') throw new ValidationError(`${id} is not a point`, where);
  };
  entities.forEach((entity, i) => {
    const where = `${path}.entities[${i}]`;
    if (entity.type === 'line') [entity.p1, entity.p2].forEach((id) => expectPoint(id, where));
    if (entity.type === 'circle') expectPoint(entity.center, where);
    if (entity.type === 'arc') [entity.center, entity.start, entity.end].forEach((id) => expectPoint(id, where));
    if (entity.type === 'ellipse') [entity.center, entity.major, entity.minor].forEach((id) => expectPoint(id, where));
    if (entity.type === 'spline') entity.points.forEach((id) => expectPoint(id, where));
  });
  const ids = new Set(kinds.keys());
  constraints.forEach((constraint, i) => {
    if (ids.has(constraint.id)) throw new ValidationError(`duplicate id ${constraint.id}`, `${path}.constraints[${i}]`);
    ids.add(constraint.id);
    for (const field of REFERENCE_FIELDS) {
      const ref = (constraint as unknown as Record<string, unknown>)[field];
      if (typeof ref === 'string' && !kinds.has(ref)) throw new ValidationError(`unknown reference ${ref}`, `${path}.constraints[${i}].${field}`);
    }
  });
  return { entities, constraints };
}

function unitVector(value: unknown, path: string) {
  const v = vec3(value, path);
  const length = Math.hypot(v[0], v[1], v[2]);
  if (Math.abs(length - 1) > 1e-6) throw new ValidationError('expected a unit vector', path);
  return v;
}

export function parsePlaneRef(raw: unknown, path = 'plane'): SketchPlaneRef {
  if (!isObject(raw)) throw new ValidationError('expected an object', path);
  if (raw.kind === 'standard') {
    if (raw.plane !== 'front' && raw.plane !== 'top' && raw.plane !== 'right') throw new ValidationError('unknown plane', `${path}.plane`);
    return { kind: 'standard', plane: raw.plane };
  }
  if (raw.kind === 'face') {
    if (typeof raw.face !== 'number' || !Number.isInteger(raw.face) || raw.face < 0) throw new ValidationError('expected a face index', `${path}.face`);
    if (!isObject(raw.frame)) throw new ValidationError('expected a frame', `${path}.frame`);
    const frame: SketchFrame = {
      origin: vec3(raw.frame.origin, `${path}.frame.origin`),
      xDir: unitVector(raw.frame.xDir, `${path}.frame.xDir`),
      yDir: unitVector(raw.frame.yDir, `${path}.frame.yDir`),
      normal: unitVector(raw.frame.normal, `${path}.frame.normal`),
    };
    return { kind: 'face', face: raw.face, frame };
  }
  throw new ValidationError('unknown plane kind', `${path}.kind`);
}
