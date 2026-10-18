// Verifies that the prebuilt kernel in vendor/parawerk-kernel matches its manifest checksums.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../vendor/parawerk-kernel');
const manifest = JSON.parse(readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
let ok = true;
for (const [file, expected] of Object.entries(manifest.files)) {
  const actual = createHash('sha256').update(readFileSync(path.join(folder, file))).digest('hex');
  const match = actual === expected;
  ok &&= match;
  console.log(`${match ? '✓' : '✗'} ${file} ${actual.slice(0, 16)}…`);
}
console.log(`ParaWerk kernel: OCCT ${manifest.occt}, Emscripten ${manifest.emscripten}, built ${manifest.built}`);
if (!ok) {
  console.error('Kernel files do not match manifest.json; rebuild with scripts/build-kernel.sh.');
  process.exit(1);
}
