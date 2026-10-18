import { describe, expect, it } from 'vitest';
import { defaultFeature, FEATURE_TYPES, type Feature } from '../../src/shared/model/feature.ts';
import { decodePartFile, encodePartFile, PartFileError, PART_FORMAT } from '../../src/shared/model/part-file.ts';
import { parseFeature, parseFeatures, ValidationError } from '../../src/shared/model/validate.ts';
import { strToU8, zipSync } from 'fflate';

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

describe('part file', () => {
  const features: Feature[] = [defaultFeature('box', 'b'), { id: 'f', type: 'fillet', radius: 2, edges: [{ kind: 'edge-index', index: 3 }], name: 'Edge round' }];

  it('round-trips the document', () => {
    const bytes = encodePartFile({ units: 'mm', features }, { appVersion: '1.2.3', savedAt: '2026-10-18T00:00:00Z' });
    const { document, meta } = decodePartFile(bytes);
    expect(document.features).toEqual(features);
    expect(meta.appVersion).toBe('1.2.3');
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
