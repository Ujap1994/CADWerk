import { isEdgeFeature } from '../../../shared/model/feature.ts';
import type { FeatureResult, MassProperties, MeshPayload } from '../../../kernel/protocol.ts';
import { t } from '../i18n.ts';
import { KernelClient, KernelCrashedError } from '../kernel/kernel-client.ts';
import { rebuildPlan, type RebuildPlan } from './document.ts';
import { getState, setState, showToast, store, type DisplayMeshes } from './store.ts';

/** Show "Rebuilding…" only for rebuilds that take noticeably long, to avoid flicker while typing. */
const BUSY_INDICATOR_DELAY_MS = 150;
/** Stop retrying after this many kernel crashes on the same document state. */
const MAX_CRASHES_PER_PLAN = 2;

let client: KernelClient | null = null;
let running = false;
let queued = false;
let crashes = { plan: '', count: 0 };
const idleWaiters: (() => void)[] = [];

export function startKernel(): KernelClient {
  client = new KernelClient(
    () => new Worker(new URL('../../../kernel/worker.ts', import.meta.url), { type: 'module', name: 'parawerk-kernel' }),
    {
      onReady: () => {
        if (getState().kernelStatus === 'loading') setState({ kernelStatus: 'ready' });
      },
      onWarm: () => undefined,
      onRestart: (reason) => {
        if (reason !== 'memory' && reason !== 'disposed') showToast('error', t('toasts.kernelRestarted'));
        scheduleRebuild();
      },
    },
  );

  store.subscribe((state, previous) => {
    // Sketch edits do not change the body; only entering or leaving sketch mode rolls the model back or forward.
    if (
      state.history.features !== previous.history.features ||
      state.activeEdit !== previous.activeEdit ||
      state.sketch?.index !== previous.sketch?.index
    ) {
      scheduleRebuild();
    }
  });
  scheduleRebuild();
  return client;
}

export function kernel(): KernelClient {
  if (!client) throw new Error('kernel not started');
  return client;
}

export function scheduleRebuild(): void {
  queued = true;
  if (!running) void runLoop();
}

/** Resolves when no rebuild is running or queued (used by tests and exports). */
export function whenIdle(): Promise<void> {
  if (!running && !queued) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}

function planSignature(plan: RebuildPlan): string {
  return JSON.stringify(plan);
}

async function runLoop(): Promise<void> {
  if (!client) return;
  running = true;
  while (queued) {
    queued = false;
    const state = getState();
    const plan = rebuildPlan(state.history.features, state.activeEdit, state.sketch?.index ?? null);
    const busyTimer = setTimeout(() => setState({ kernelStatus: 'busy' }), BUSY_INDICATOR_DELAY_MS);
    try {
      const { result, meshes } = await client.rebuild({
        features: plan.features,
        captures: plan.captures,
        withProperties: state.activeEdit === null && state.sketch === null,
      });
      crashes = { plan: '', count: 0 };
      // A newer state is already waiting: skip these results to avoid flicker.
      if (queued) continue;
      applyResult(plan, result.features, result.captures[result.captures.length - 1]?.properties ?? null, meshes, {
        totalMs: result.timings.totalMs,
        rebuiltFeatures: result.timings.rebuiltFeatures,
      });
      setState({ kernelStatus: 'ready' });
    } catch (error) {
      if (error instanceof KernelCrashedError) {
        const signature = planSignature(plan);
        crashes = crashes.plan === signature ? { plan: signature, count: crashes.count + 1 } : { plan: signature, count: 1 };
        if (crashes.count > MAX_CRASHES_PER_PLAN) {
          // The same state keeps crashing the kernel; wait for the user to change the document (e.g. undo).
          queued = false;
          setState({ kernelStatus: 'error' });
        }
      } else {
        setState({ kernelStatus: 'error' });
        showToast('error', t('errors.unknown', { detail: error instanceof Error ? error.message : String(error) }));
      }
    } finally {
      clearTimeout(busyTimer);
    }
  }
  running = false;
  for (const resolve of idleWaiters.splice(0)) resolve();
  void client.recycleIfNeeded().catch(() => undefined);
}

function applyResult(
  plan: RebuildPlan,
  results: FeatureResult[],
  properties: MassProperties | null,
  meshes: Map<number, MeshPayload | null>,
  timings: { totalMs: number; rebuiltFeatures: number },
): void {
  const { activeEdit, sketch } = getState();
  const last = plan.features.length - 1;
  let display: DisplayMeshes;
  if (sketch) {
    display = { body: meshes.get(last) ?? null, preview: null, pickable: false };
  } else if (!activeEdit) {
    display = { body: meshes.get(last) ?? null, preview: null, pickable: true };
  } else if (isEdgeFeature(activeEdit.draft)) {
    display = { body: meshes.get(activeEdit.index - 1) ?? null, preview: meshes.get(activeEdit.index) ?? null, pickable: true };
  } else {
    display = { body: meshes.get(activeEdit.index) ?? null, preview: null, pickable: false };
  }

  setState((state) => {
    const bodyChanged = state.display.body?.key !== display.body?.key;
    return {
      display,
      rebuild: {
        results,
        properties: activeEdit || sketch ? (state.rebuild?.properties ?? null) : properties,
        totalMs: timings.totalMs,
        rebuiltFeatures: timings.rebuiltFeatures,
      },
      // Topological indices refer to one specific body; a new body invalidates the selection.
      ...(bodyChanged ? { selection: [], hover: null } : {}),
    };
  });
}
