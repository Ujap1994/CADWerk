import type { ViewportEngine } from './engine.ts';

/** What commands need from the sketch controller (see sketch/controller.ts). */
export interface SketchToolControl {
  /** Handles Esc in sketch mode: ends the current shape or leaves the tool; false if there was nothing to do. */
  escape(): boolean;
}

let engine: ViewportEngine | null = null;
let sketchControl: SketchToolControl | null = null;

export function registerSketchControl(control: SketchToolControl | null): void {
  sketchControl = control;
}

export function sketchToolControl(): SketchToolControl | null {
  return sketchControl;
}

export function registerViewport(instance: ViewportEngine | null): void {
  engine = instance;
}

export function viewport(): ViewportEngine | null {
  return engine;
}
