import type { ViewportEngine } from './engine.ts';

let engine: ViewportEngine | null = null;

export function registerViewport(instance: ViewportEngine | null): void {
  engine = instance;
}

export function viewport(): ViewportEngine | null {
  return engine;
}
