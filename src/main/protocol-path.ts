import path from 'node:path';
import { APP_HOST, APP_SCHEME } from '../shared/app-info.ts';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function mimeType(file: string): string {
  return MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Maps an `app://parawerk/...` URL to a file below `root`.
 * Returns null for foreign URLs and for any path that would escape `root`.
 */
export function resolveAppPath(root: string, url: string): string | null {
  let parsed: URL;
  let pathname: string;
  try {
    parsed = new URL(url);
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.host !== APP_HOST) return null;
  if (pathname.includes('\0')) return null;

  const relative = pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\/+/, '');
  const base = path.resolve(root);
  const full = path.resolve(base, relative);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}
