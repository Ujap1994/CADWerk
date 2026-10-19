import { describe, expect, it } from 'vitest';
import { defaultFeature, FEATURE_TYPES, type Feature, type SketchFeature } from '../../src/shared/model/feature.ts';
import { decodePartFile, encodePartFile, PartFileError, PART_FORMAT } from '../../src/shared/model/part-file.ts';
import { parseFeature, parseFeatures, ValidationError } from '../../src/shared/model/validate.ts';
import { strToU8, unzipSync, zipSync } from 'fflate';

describe('feature validation', () => {
  it('accepts every default feature', () => {
    for (const type of FEATURE_TYPES) expect(parseFeature(defaultFeature(type, 'id'))).toEqual(defaultFeature(type, 'id'));
  });

  it.each([
    [{ id: 'a', type: 'box', operation: 'add', width: 0, depth: 1, height: 1, position: [0, 0, 0] }, 'width'],
    [{ id: 'a', type: 'box', operation: 'add', width: 1, depth: 1, height: 1, position: [0, 0] }, 'position'],
    [{ id: 'a', type: 'box', operation: 'xor', width: 1, depth: 1, height: 1, position: [0, 0, 0] }, 'operation'],
    [{ id: 'a', type: 'cylinder', operation: 'add', radius: Number.NaN, height: 1, axis: 'z', position: [0, 0, 0] }, 'radius'],
    [{ id: 'a', type: 'cylinder', operation: 'add', radius: 1, height: 1, axis: 'w', position: [0, 0, 0] }, 'axis'],
    [{ id: 'a', type: 'fillet', radius: 1, edges: [{ kind: 'edge-index', index: -1 }] }, 'index'],
    [{ id: 'a', type: 'fillet', radius: 1e9, edges: [] }, 'radius'],
    [{ id: 'a', type: 'sweep' }, 'type'],
    [{ type: 'box' }, 'id'],
  ])('rejects invalid input %#', (raw, field) => {
    expect(() => parseFeature(raw)).toThrow(ValidationError);
    expect(() => parseFeature(raw)).toThrow(field);
  });

  it('rejects duplicate ids', () => {
    const box = defaultFeature('box', 'same');
    expect(() => parseFeatures([box, box])).toThrow('duplicate');
  });
});

describe('sketch validation', () => {
  const sketch: SketchFeature = {
    id: 's',
    type: 'sketch',
    plane: { kind: 'standard', plane: 'front' },
    sketch: {
      entities: [
        { id: 'p1', type: 'point', x: 0, y: 0 },
        { id: 'p2', type: 'point', x: 10, y: 0 },
        { id: 'p3', type: 'point', x: 5, y: 5, construction: true },
        { id: 'l1', type: 'line', p1: 'p1', p2: 'p2' },
        { id: 'c1', type: 'circle', center: 'p3', radius: 2 },
        { id: 'a1', type: 'arc', center: 'p3', start: 'p2', end: 'p1' },
      ],
      constraints: [
        { id: 'k1', type: 'coincident', a: 'p1', b: 'origin' },
        { id: 'k2', type: 'horizontal', line: 'l1' },
        { id: 'k3', type: 'tangent', a: 'l1', b: 'c1', inner: false },
        { id: 'd1', type: 'distance', a: 'p1', b: 'p2', value: 10, driving: true, offset: [0, -5] },
        { id: 'd2', type: 'angle', a: 'l1', b: 'l1', value: 0, driving: false },
      ],
    },
  };

  it('round-trips a valid sketch', () => {
    expect(parseFeature(JSON.parse(JSON.stringify(sketch)))).toEqual(sketch);
  });

  it('accepts sketches on planar faces', () => {
    const onFace = { ...sketch, plane: { kind: 'face', face: 3, frame: { origin: [0, 0, 10], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } } };
    expect(parseFeature(onFace)).toEqual(onFace);
  });

  function withSketch(change: (data: { entities: unknown[]; constraints: unknown[] }) => void): unknown {
    const copy = JSON.parse(JSON.stringify(sketch));
    change(copy.sketch);
    return copy;
  }

  it.each([
    [withSketch((d) => d.entities.push({ id: 'l2', type: 'line', p1: 'p1', p2: 'nothing' })), 'not a point'],
    [withSketch((d) => d.entities.push({ id: 'l2', type: 'line', p1: 'p1', p2: 'l1' })), 'not a point'],
    [withSketch((d) => d.entities.push({ id: 'p1', type: 'point', x: 1, y: 1 })), 'duplicate'],
    [withSketch((d) => d.constraints.push({ id: 'k9', type: 'horizontal', line: 'gone' })), 'unknown reference'],
    [withSketch((d) => d.constraints.push({ id: 'p1', type: 'horizontal', line: 'l1' })), 'duplicate'],
    [withSketch((d) => d.constraints.push({ id: 'k9', type: 'radius', circle: 'c1', value: -1, driving: true })), 'non-negative'],
    [withSketch((d) => d.constraints.push({ id: 'k9', type: 'glue', a: 'p1', b: 'p2' })), 'unknown constraint'],
    [withSketch((d) => d.entities.push({ id: 'q', type: 'clothoid' })), 'unknown sketch entity'],
    [withSketch((d) => d.entities.push({ id: 'q', type: 'spline', points: ['p1'] })), '2 to 1000 points'],
    [withSketch((d) => d.entities.push({ id: 'q', type: 'point', x: Number.POSITIVE_INFINITY, y: 0 })), 'x'],
    [{ ...sketch, plane: { kind: 'standard', plane: 'side' } }, 'plane'],
    [{ ...sketch, plane: { kind: 'face', face: 1, frame: { origin: [0, 0, 0], xDir: [2, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } } }, 'unit vector'],
  ])('rejects invalid sketches %#', (raw, message) => {
    expect(() => parseFeature(raw)).toThrow(ValidationError);
    expect(() => parseFeature(raw)).toThrow(message);
  });
});

describe('part file', () => {
  const features: Feature[] = [defaultFeature('box', 'b'), { id: 'f', type: 'fillet', radius: 2, edges: [{ kind: 'edge-index', index: 3 }], name: 'Edge round' }];

  it('round-trips the document', () => {
    const bytes = encodePartFile({ units: 'mm', features }, { appVersion: '1.2.3', savedAt: '2026-10-18T00:00:00Z' });
    const { document, meta } = decodePartFile(bytes);
    expect(document.features).toEqual(features);
    expect(meta.appVersion).toBe('1.2.3');
  });

  it('writes version 1 without sketches and version 2 with them', () => {
    const versionOf = (list: Feature[]) => {
      const bytes = encodePartFile({ units: 'mm', features: list }, { appVersion: '1', savedAt: '' });
      return JSON.parse(new TextDecoder().decode(unzipSync(bytes)['document.json'])).version;
    };
    expect(versionOf(features)).toBe(1);
    const withSketch = [defaultFeature('sketch', 's'), ...features];
    expect(versionOf(withSketch)).toBe(2);
    const bytes = encodePartFile({ units: 'mm', features: withSketch }, { appVersion: '1', savedAt: '' });
    expect(decodePartFile(bytes).document.features).toEqual(withSketch);
  });

  function zipWith(document: unknown): Uint8Array {
    return zipSync({ 'document.json': strToU8(JSON.stringify(document)) });
  }

  it.each([
    [new Uint8Array([1, 2, 3]), 'not-a-zip'],
    [zipSync({ 'other.txt': strToU8('x') }), 'missing-document'],
    [zipWith({ format: 'something-else', version: 1, units: 'mm', features: [] }), 'wrong-format'],
    [zipWith({ format: PART_FORMAT, version: 99, units: 'mm', features: [] }), 'newer-version'],
    [zipWith({ format: PART_FORMAT, version: 1, units: 'mm', features: [{ id: 'x', type: 'box' }] }), 'invalid-content'],
    [zipWith({ format: PART_FORMAT, version: 1, units: 'inch', features: [] }), 'invalid-content'],
  ])('reports damaged files with a code %#', (bytes, code) => {
    try {
      decodePartFile(bytes);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PartFileError);
      expect((error as PartFileError).code).toBe(code);
    }
  });

  it('opens files with a damaged meta.json', () => {
    const bytes = zipSync({
      'document.json': strToU8(JSON.stringify({ format: PART_FORMAT, version: 1, units: 'mm', features })),
      'meta.json': strToU8('{broken'),
    });
    expect(decodePartFile(bytes).document.features).toHaveLength(2);
  });
});
