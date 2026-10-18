import { describe, expect, it } from 'vitest';
import { featureKeys, hashString } from '../../src/kernel/rebuild.ts';
import { writeBinaryStl } from '../../src/kernel/stl.ts';
import { displayQuality, exportQuality } from '../../src/kernel/mesh.ts';
import { defaultFeature, type BoxFeature } from '../../src/shared/model/feature.ts';

describe('binary STL writer', () => {
  it('writes header, count, normal and vertices', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const bytes = writeBinaryStl(positions, new Uint32Array([0, 1, 2]));
    const view = new DataView(bytes.buffer);
    expect(bytes.length).toBe(84 + 50);
    expect(new TextDecoder().decode(bytes.slice(0, 19))).toBe('ParaWerk binary STL');
    expect(view.getUint32(80, true)).toBe(1);
    expect([view.getFloat32(84, true), view.getFloat32(88, true), view.getFloat32(92, true)]).toEqual([0, 0, 1]);
    expect(view.getFloat32(96 + 12, true)).toBe(1);
  });
});

describe('rebuild keys', () => {
  const box = defaultFeature('box', 'b') as BoxFeature;
  const fillet = defaultFeature('fillet', 'f');

  it('ignore display names', () => {
    expect(featureKeys([{ ...box, name: 'Plate' }])).toEqual(featureKeys([box]));
  });

  it('change with parameters and propagate to later features', () => {
    const before = featureKeys([box, fillet]);
    const after = featureKeys([{ ...box, width: 101 }, fillet]);
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
  });

  it('do not depend on property order', () => {
    const reordered = JSON.parse(JSON.stringify({ position: box.position, height: box.height, id: box.id, type: box.type, operation: box.operation, depth: box.depth, width: box.width }));
    expect(featureKeys([reordered])).toEqual(featureKeys([box]));
  });

  it('hash strings deterministically', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
});

describe('mesh quality', () => {
  it('scales with the part size within limits', () => {
    expect(displayQuality(100).linear).toBeCloseTo(0.05);
    expect(displayQuality(1).linear).toBe(0.002);
    expect(displayQuality(1e7).linear).toBe(2);
    expect(exportQuality(100).linear).toBeLessThan(displayQuality(100).linear);
  });
});
