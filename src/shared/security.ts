/**
 * Security headers shared by the dev server and the production `app://` protocol.
 *
 * Cross-origin isolation is enabled from the start so that a multi-threaded
 * geometry kernel (SharedArrayBuffer) can be adopted later without changes.
 */
export const crossOriginIsolationHeaders: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/** File name pattern of the geometry kernel worker bundle (see protocol.ts). */
export const KERNEL_WORKER_PATTERN = /\/assets\/worker-[\w-]+\.js$/;

/**
 * Content security policy for the UI and, with `worker`, for the geometry kernel worker.
 *
 * The OCCT bindings (Emscripten embind) generate glue functions with `new Function`
 * at load time, so the kernel worker alone needs 'unsafe-eval'. It only runs our
 * bundled code and never evaluates document data. A custom OCCT build with
 * -sDYNAMIC_EXECUTION=0 removes this exception (docs/adr/0001-geometry-kernel.md).
 */
export function contentSecurityPolicy({ dev, worker = false }: { dev: boolean; worker?: boolean }): string {
  const directives = [
    "default-src 'self'",
    // The React fast-refresh preamble is an inline script, so only the dev server allows inline scripts.
    `script-src 'self' 'wasm-unsafe-eval'${dev ? " 'unsafe-inline'" : ''}${worker ? " 'unsafe-eval'" : ''}`,
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? ' ws: http://localhost:*' : ''}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ];
  return directives.join('; ');
}
