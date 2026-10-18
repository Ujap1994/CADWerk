import { protocol } from 'electron';
import { readFile } from 'node:fs/promises';
import { APP_SCHEME } from '../shared/app-info.ts';
import { contentSecurityPolicy, crossOriginIsolationHeaders, KERNEL_WORKER_PATTERN } from '../shared/security.ts';
import { mimeType, resolveAppPath } from './protocol-path.ts';

/** Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
    },
  ]);
}

/**
 * Serves the built renderer from `root`. A custom protocol (instead of file://)
 * gives the renderer a proper origin, strict CSP headers and cross-origin isolation.
 */
export function registerAppProtocol(root: string): void {
  const csp = contentSecurityPolicy({ dev: false });
  const workerCsp = contentSecurityPolicy({ dev: false, worker: true });
  protocol.handle(APP_SCHEME, async (request) => {
    const file = resolveAppPath(root, request.url);
    if (!file) return new Response('Not found', { status: 404 });
    const isKernelWorker = KERNEL_WORKER_PATTERN.test(new URL(request.url).pathname);
    try {
      const data = await readFile(file);
      return new Response(data, {
        headers: {
          'Content-Type': mimeType(file),
          'Content-Security-Policy': isKernelWorker ? workerCsp : csp,
          'X-Content-Type-Options': 'nosniff',
          ...crossOriginIsolationHeaders,
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}
