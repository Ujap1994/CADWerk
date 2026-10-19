import type { Feature } from '../shared/model/feature.ts';
import type { GeometryBackend, ShapeHandle } from './backend.ts';
import { FeatureError } from './feature-error.ts';
import type { FeatureResult } from './protocol.ts';

interface CacheEntry {
  /** Identifies this feature together with everything before it. */
  key: string;
  /** Key of the entry that produced the shape (suppressed and failed features pass the body through). */
  shapeKey: string;
  shape: ShapeHandle | null;
  ownsShape: boolean;
  result: FeatureResult;
}

export const ROOT_KEY = 'root';

/** cyrb53: a fast 53-bit string hash. */
export function hashString(text: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Everything that influences the geometry of a feature (the display name does not). */
function featureSignature(feature: Feature): string {
  // A sketch never changes the body, so editing it must not invalidate the features after it.
  if (feature.type === 'sketch') return `sketch:${feature.id}`;
  const { name: _name, ...geometry } = feature;
  return stableStringify(geometry);
}

export function featureKeys(features: readonly Feature[]): string[] {
  let previous = ROOT_KEY;
  return features.map((feature) => {
    previous = hashString(`${previous}|${featureSignature(feature)}`);
    return previous;
  });
}

/**
 * Incremental rebuild of the feature list.
 *
 * The body after each feature is cached. A rebuild starts at the first feature
 * whose key (its own parameters plus everything before it) changed, so editing
 * the last feature never recomputes the ones before it.
 */
export class Rebuilder implements Disposable {
  private readonly backend: GeometryBackend;
  private entries: CacheEntry[] = [];

  constructor(backend: GeometryBackend) {
    this.backend = backend;
  }

  get cachedShapes(): number {
    return this.entries.filter((entry) => entry.ownsShape).length;
  }

  rebuild(features: readonly Feature[]): { results: FeatureResult[]; rebuilt: number } {
    const keys = featureKeys(features);
    let firstChanged = features.length;
    for (let i = 0; i < features.length; i++) {
      if (this.entries[i]?.key !== keys[i]) {
        firstChanged = i;
        break;
      }
    }
    this.truncate(firstChanged);

    for (let i = firstChanged; i < features.length; i++) {
      const feature = features[i] as Feature;
      const key = keys[i] as string;
      const previous = this.entries[i - 1];
      const input = previous?.shape ?? null;
      const inputKey = previous?.shapeKey ?? ROOT_KEY;
      const start = performance.now();

      // Sketches do not change the body (extrude features consume them).
      if (feature.suppressed || feature.type === 'sketch') {
        this.entries.push({
          key,
          shapeKey: inputKey,
          shape: input,
          ownsShape: false,
          result: { id: feature.id, status: feature.suppressed ? 'suppressed' : 'ok', timeMs: 0, cached: false },
        });
        continue;
      }

      try {
        const shape = this.backend.applyFeature(input, feature);
        this.entries.push({
          key,
          shapeKey: key,
          shape,
          ownsShape: true,
          result: { id: feature.id, status: 'ok', timeMs: performance.now() - start, cached: false },
        });
      } catch (error) {
        const failure =
          error instanceof FeatureError
            ? { code: error.code, ...(error.detail === undefined ? {} : { detail: error.detail }) }
            : { code: 'unknown' as const, detail: this.backend.describeError(error) };
        this.entries.push({
          key,
          shapeKey: inputKey,
          shape: input,
          ownsShape: false,
          result: { id: feature.id, status: 'error', error: failure, timeMs: performance.now() - start, cached: false },
        });
      }
    }

    const results = this.entries.map((entry, i) =>
      i < firstChanged ? { ...entry.result, timeMs: 0, cached: true } : entry.result,
    );
    return { results, rebuilt: features.length - firstChanged };
  }

  /** Body after the feature at `index`; index -1 is the empty start state. */
  shapeAfter(index: number): ShapeHandle | null {
    return index < 0 ? null : (this.entries[index]?.shape ?? null);
  }

  shapeKeyAfter(index: number): string {
    return index < 0 ? ROOT_KEY : (this.entries[index]?.shapeKey ?? ROOT_KEY);
  }

  private truncate(from: number): void {
    for (let i = this.entries.length - 1; i >= from; i--) {
      const entry = this.entries[i];
      if (entry?.ownsShape && entry.shape) this.backend.release(entry.shape);
    }
    this.entries.length = Math.min(this.entries.length, from);
  }

  [Symbol.dispose](): void {
    this.truncate(0);
  }
}
