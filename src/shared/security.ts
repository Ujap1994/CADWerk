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

/**
 * Content security policy for the UI and its workers. No 'unsafe-eval' anywhere: the
 * geometry kernel is compiled with -sDYNAMIC_EXECUTION=0 (docs/adr/0001-geometry-kernel.md).
 */
export function contentSecurityPolicy({ dev }: { dev: boolean }): string {
  const directives = [
    "default-src 'self'",
    // The React fast-refresh preamble is an inline script, so only the dev server allows inline scripts.
    `script-src 'self' 'wasm-unsafe-eval'${dev ? " 'unsafe-inline'" : ''}`,
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
