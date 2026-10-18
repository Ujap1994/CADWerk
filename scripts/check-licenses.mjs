// Verifies that every package bundled into the app has a license compatible with GPL-3.0-or-later.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Libraries bundled into the renderer, main process or kernel worker. */
const BUNDLED = ['react', 'react-dom', 'three', 'three-mesh-bvh', 'i18next', 'react-i18next', 'zustand', 'fflate'];
const ALLOWED = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'Zlib', 'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-2.0-or-later', 'GPL-3.0-or-later']);

const seen = new Map();
function visit(name) {
  if (seen.has(name)) return;
  const file = path.join(root, 'node_modules', name, 'package.json');
  if (!existsSync(file)) return;
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  const license = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'UNKNOWN');
  seen.set(name, { version: pkg.version, license });
  for (const dependency of Object.keys(pkg.dependencies ?? {})) visit(dependency);
}
BUNDLED.forEach(visit);

let failed = false;
for (const [name, { version, license }] of [...seen].sort()) {
  const ok = license.split(/\s+OR\s+/).some((option) => ALLOWED.has(option.replace(/[()]/g, '')));
  console.log(`${ok ? '✓' : '✗'} ${name}@${version}  ${license}`);
  if (!ok) failed = true;
}
if (failed) {
  console.error('\nSome bundled packages have licenses that are not on the GPL-3.0-compatible allowlist.');
  process.exit(1);
}

// With --write, collect the license texts so they ship with the app (build/licenses → resources/licenses).
if (process.argv.includes('--write')) {
  const target = path.join(root, 'build/licenses');
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  copyFileSync(path.join(root, 'LICENSE'), path.join(target, 'ParaWerk-GPL-3.0.txt'));
  copyFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(target, 'THIRD_PARTY_NOTICES.md'));
  // The geometry kernel bundles Open CASCADE Technology (LGPL-2.1 with exception), see vendor/parawerk-kernel.
  for (const file of ['OCCT_LICENSE_LGPL_21.txt', 'OCCT_LGPL_EXCEPTION.txt']) {
    copyFileSync(path.join(root, 'vendor/parawerk-kernel', file), path.join(target, file));
  }
  for (const name of seen.keys()) {
    const folder = path.join(root, 'node_modules', name);
    const licenseFile = readdirSync(folder).find((file) => /^(licen[cs]e|copying)(\.|$)/i.test(file));
    const safeName = name.replace('/', '__');
    if (licenseFile) copyFileSync(path.join(folder, licenseFile), path.join(target, `${safeName}.txt`));
    else writeFileSync(path.join(target, `${safeName}.txt`), `${name}: ${seen.get(name).license} (no license file in package)\n`);
  }
  console.log(`\nWrote ${seen.size + 2} license files to build/licenses`);
}
