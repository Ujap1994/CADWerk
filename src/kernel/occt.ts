import init from 'replicad-opencascadejs';
import type { OpenCascadeInstance, TopoDS_Shape } from 'replicad-opencascadejs';

export type OC = OpenCascadeInstance;
export type { TopoDS_Shape };

/** Loads the OCCT WebAssembly module. In Node the .wasm file is found next to the module. */
export async function loadOpenCascade(wasmUrl?: string): Promise<OC> {
  return init(wasmUrl === undefined ? {} : { locateFile: () => wasmUrl });
}

interface Deletable {
  delete(): void;
  isDeleted?(): boolean;
}

/**
 * Owns Emscripten-bound C++ objects and deletes them when disposed.
 *
 * Embind objects are not garbage collected, so every `new oc.X()` and every
 * shape returned by value must be released. Use with `using arena = new Arena()`.
 */
export class Arena implements Disposable {
  private readonly items: { item: Deletable; cleanup?: () => void }[] = [];

  track<T extends Deletable>(item: T): T {
    this.items.push({ item });
    return item;
  }

  /**
   * Tracks an OCCT algorithm and calls its `Clear()` before deleting it.
   *
   * In the current WebAssembly build, `delete()` alone does not release the
   * internal data of BRepAlgoAPI algorithms (about 200 KB per boolean); `Clear()`
   * does. See docs/adr/0001-geometry-kernel.md.
   */
  trackAlgorithm<T extends Deletable & { Clear(): void }>(item: T): T {
    this.items.push({ item, cleanup: () => item.Clear() });
    return item;
  }

  /** Removes an object from the arena so it outlives it; the caller takes ownership. */
  keep<T extends Deletable>(item: T): T {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i]?.item === item) {
        this.items.splice(i, 1);
        break;
      }
    }
    return item;
  }

  [Symbol.dispose](): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const entry = this.items[i];
      if (!entry) continue;
      try {
        if (!(entry.item.isDeleted?.() ?? false)) {
          entry.cleanup?.();
          entry.item.delete();
        }
      } catch {
        // Already released elsewhere; nothing to do.
      }
    }
    this.items.length = 0;
  }
}

/** Turns an exception thrown by OCCT (or our own code) into a readable message. */
export function describeError(oc: OC, error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof WebAssembly !== 'undefined' && 'Exception' in WebAssembly && error instanceof WebAssembly.Exception) {
    try {
      const [type, message] = oc.getExceptionMessage(error);
      return [type, message].filter((part) => part && part.length > 0).join(': ') || 'OCCT exception';
    } catch {
      return 'OCCT exception';
    }
  }
  if (typeof error === 'number') {
    try {
      return oc.OCJS.getStandard_FailureData(error).GetMessageString() || 'OCCT exception';
    } catch {
      return 'OCCT exception';
    }
  }
  return String(error);
}
