// Verifies that the prebuilt kernel in vendor/parawerk-kernel matches its manifest checksums.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = path.join(repo, 'vendor/parawerk-kernel');
const manifest = JSON.parse(readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
let ok = true;
for (const [file, expected] of Object.entries(manifest.files)) {
  const actual = createHash('sha256').update(readFileSync(path.join(folder, file))).digest('hex');
  const match = actual === expected;
  ok &&= match;
  console.log(`${match ? '✓' : '✗'} ${file} ${actual.slice(0, 16)}…`);
}
for (const [file, expected] of Object.entries(manifest.sources ?? {})) {
  // Line endings may differ on Windows checkouts; hash with LF.
  const text = readFileSync(path.join(repo, file), 'utf8').replace(/\r\n/g, '\n');
  const actual = createHash('sha256').update(text).digest('hex');
  const match = actual === expected;
  ok &&= match;
  console.log(`${match ? '✓' : '✗'} ${file} (source)`);
}
console.log(`ParaWerk kernel: OCCT ${manifest.occt}, Emscripten ${manifest.emscripten}, built ${manifest.built}`);
if (!ok) {
  console.error('The kernel binary does not match its sources; rebuild it with scripts/build-kernel.sh.');
  process.exit(1);
}
