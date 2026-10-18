import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mimeType, resolveAppPath } from '../../src/main/protocol-path.ts';
import { contentSecurityPolicy } from '../../src/shared/security.ts';

const root = path.resolve('/app/out/renderer');

describe('app protocol', () => {
  it('maps app URLs into the renderer folder', () => {
    expect(resolveAppPath(root, 'app://parawerk/index.html')).toBe(path.join(root, 'index.html'));
    expect(resolveAppPath(root, 'app://parawerk/')).toBe(path.join(root, 'index.html'));
    expect(resolveAppPath(root, 'app://parawerk/assets/a%20b.js')).toBe(path.join(root, 'assets/a b.js'));
  });

  it.each([
    'app://parawerk/../secret.txt',
    'app://parawerk/%2e%2e/%2e%2e/etc/passwd',
    'app://parawerk/..%5c..%5cwindows',
    'app://other/index.html',
    'https://parawerk/index.html',
    'app://parawerk/%E0%A4%A',
    'app://parawerk/a%00b',
    'not a url',
  ])('rejects %s', (url) => {
    const resolved = resolveAppPath(root, url);
    if (resolved !== null) expect(resolved.startsWith(root + path.sep)).toBe(true);
    else expect(resolved).toBeNull();
  });

  it('serves WebAssembly with the right MIME type', () => {
    expect(mimeType('kernel.wasm')).toBe('application/wasm');
    expect(mimeType('x.unknown')).toBe('application/octet-stream');
  });
});

describe('content security policy', () => {
  it('forbids eval and inline scripts in the UI', () => {
    const csp = contentSecurityPolicy({ dev: false });
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("'unsafe-inline' ");
    expect(csp).toContain("object-src 'none'");
  });

  it('never allows eval, not even in development', () => {
    expect(contentSecurityPolicy({ dev: true })).not.toContain("'unsafe-eval'");
  });
});
