import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { contentSecurityPolicy, crossOriginIsolationHeaders } from './src/shared/security.ts';

/** Injects the content security policy into index.html (relaxed only for the dev server). */
function cspPlugin(): Plugin {
  return {
    name: 'parawerk-csp',
    transformIndexHtml(html, ctx) {
      return html.replace('%CONTENT_SECURITY_POLICY%', contentSecurityPolicy({ dev: ctx.server !== undefined }));
    },
  };
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react(), cspPlugin()],
    worker: { format: 'es' },
    server: { headers: crossOriginIsolationHeaders },
    preview: { headers: crossOriginIsolationHeaders },
    optimizeDeps: { exclude: ['replicad-opencascadejs', '@salusoft89/planegcs'] },
    build: {
      target: 'esnext',
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 4096,
    },
  },
});
