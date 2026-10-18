// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
declare var RuntimeExports: {
    /** @type {any} */
    wasmMemory: any;
};
interface WasmModule {
}

interface EmbindModule {
  release(_0: number): void;
  shapeCount(): number;
  version(): string;
  makeBox(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number): any;
  makeCylinder(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number): any;
  booleanOperation(_0: number, _1: number, _2: number): any;
  fillet(_0: number, _1: any, _2: number): any;
  chamfer(_0: number, _1: any, _2: number): any;
  counts(_0: number): any;
  boundingBox(_0: number): any;
  massProperties(_0: number): any;
  mesh(_0: number, _1: number, _2: number, _3: boolean): any;
  exportMesh(_0: number, _1: number, _2: number): any;
  exportStep(_0: number): any;
  importStep(_0: any): any;
}

export type MainModule = WasmModule & typeof RuntimeExports & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
