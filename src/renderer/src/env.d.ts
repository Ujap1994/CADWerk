import type { ParaWerkApi } from '../../shared/ipc.ts';

declare global {
  interface Window {
    parawerk: ParaWerkApi;
  }
}

export {};
