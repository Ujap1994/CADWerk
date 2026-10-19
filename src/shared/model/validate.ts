import type { Axis, BooleanOperation, EdgeRef, Feature, Vec3 } from './feature.ts';
import { parseSketchData, parsePlaneRef } from './validate-sketch.ts';

export class ValidationError extends Error {
  readonly path: string;

  constructor(message: string, path: string) {
    super(`${path}: ${message}`);
    this.name = 'ValidationError';
    this.path = path;
  }
}

type Json = Record<string, unknown>;

/** Largest model dimension accepted, in millimeters (100 m). */
export const MAX_LENGTH = 100_000;

export function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function positiveLength(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MAX_LENGTH) {
    throw new ValidationError(`expected a length between 0 and ${MAX_LENGTH} mm`, path);
  }
  return value;
}

export function coordinate(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_LENGTH) {
    throw new ValidationError('expected a finite coordinate', path);
  }
  return value;
}

export function vec3(value: unknown, path: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) throw new ValidationError('expected [x, y, z]', path);
  return [coordinate(value[0], `${path}[0]`), coordinate(value[1], `${path}[1]`), coordinate(value[2], `${path}[2]`)];
}

function operation(value: unknown, path: string): BooleanOperation {
  if (value !== 'add' && value !== 'cut') throw new ValidationError('expected "add" or "cut"', path);
  return value;
}

function axis(value: unknown, path: string): Axis {
  if (value !== 'x' && value !== 'y' && value !== 'z') throw new ValidationError('expected "x", "y" or "z"', path);
  return value;
}

function edges(value: unknown, path: string): EdgeRef[] {
  if (!Array.isArray(value)) throw new ValidationError('expected a list of edges', path);
  return value.map((ref, i) => {
    const p = `${path}[${i}]`;
    if (!isObject(ref) || ref.kind !== 'edge-index') throw new ValidationError('unknown edge reference', p);
    const index = ref.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
      throw new ValidationError('expected a non-negative edge index', `${p}.index`);
    }
    return { kind: 'edge-index', index };
  });
}

function base(raw: Json, path: string): { id: string; name?: string; suppressed?: boolean } {
  if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 64) {
    throw new ValidationError('expected a feature id', `${path}.id`);
  }
  const result: { id: string; name?: string; suppressed?: boolean } = { id: raw.id };
  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string' || raw.name.length > 200) throw new ValidationError('invalid name', `${path}.name`);
    result.name = raw.name;
  }
  if (raw.suppressed !== undefined) {
    if (typeof raw.suppressed !== 'boolean') throw new ValidationError('expected true or false', `${path}.suppressed`);
    result.suppressed = raw.suppressed;
  }
  return result;
}

/** Parses untrusted data (e.g. from a file) into a feature, or throws a ValidationError. */
export function parseFeature(raw: unknown, path = 'feature'): Feature {
  if (!isObject(raw)) throw new ValidationError('expected an object', path);
  const common = base(raw, path);
  switch (raw.type) {
    case 'sketch':
      return {
        ...common,
        type: 'sketch',
        plane: parsePlaneRef(raw.plane, `${path}.plane`),
        sketch: parseSketchData(raw.sketch, `${path}.sketch`),
      };
    case 'box':
      return {
        ...common,
        type: 'box',
        operation: operation(raw.operation, `${path}.operation`),
        width: positiveLength(raw.width, `${path}.width`),
        depth: positiveLength(raw.depth, `${path}.depth`),
        height: positiveLength(raw.height, `${path}.height`),
        position: vec3(raw.position, `${path}.position`),
      };
    case 'cylinder':
      return {
        ...common,
        type: 'cylinder',
        operation: operation(raw.operation, `${path}.operation`),
        radius: positiveLength(raw.radius, `${path}.radius`),
        height: positiveLength(raw.height, `${path}.height`),
        axis: axis(raw.axis, `${path}.axis`),
        position: vec3(raw.position, `${path}.position`),
      };
    case 'fillet':
      return {
        ...common,
        type: 'fillet',
        radius: positiveLength(raw.radius, `${path}.radius`),
        edges: edges(raw.edges, `${path}.edges`),
      };
    case 'chamfer':
      return {
        ...common,
        type: 'chamfer',
        distance: positiveLength(raw.distance, `${path}.distance`),
        edges: edges(raw.edges, `${path}.edges`),
      };
    default:
      throw new ValidationError(`unknown feature type ${JSON.stringify(raw.type)}`, `${path}.type`);
  }
}

export function parseFeatures(raw: unknown, path = 'features'): Feature[] {
  if (!Array.isArray(raw)) throw new ValidationError('expected a list of features', path);
  const features = raw.map((item, i) => parseFeature(item, `${path}[${i}]`));
  const ids = new Set<string>();
  for (const feature of features) {
    if (ids.has(feature.id)) throw new ValidationError(`duplicate feature id ${feature.id}`, path);
    ids.add(feature.id);
  }
  return features;
}
