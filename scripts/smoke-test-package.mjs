// Starts the packaged (unpacked) app of the current platform and runs the core end-to-end tests against it.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(path.join(root, 'package.json'), 'utf8')));
const releaseDir = path.join(root, 'release', version);

const candidates = {
  darwin: ['mac-arm64/ParaWerk.app/Contents/MacOS/ParaWerk', 'mac/ParaWerk.app/Contents/MacOS/ParaWerk', 'mac-universal/ParaWerk.app/Contents/MacOS/ParaWerk'],
  win32: ['win-unpacked/ParaWerk.exe', 'win-arm64-unpacked/ParaWerk.exe'],
  linux: process.arch === 'arm64' ? ['linux-arm64-unpacked/parawerk'] : ['linux-unpacked/parawerk'],
}[process.platform] ?? [];

const executable = candidates.map((candidate) => path.join(releaseDir, candidate)).find((file) => existsSync(file));
if (!executable) {
  console.error(`No packaged app found in ${releaseDir}. Contents: ${existsSync(releaseDir) ? readdirSync(releaseDir).join(', ') : 'missing'}`);
  process.exit(1);
}
console.log(`Smoke-testing ${executable}`);

const result = spawnSync('npx', ['playwright', 'test', '--project=e2e', '-g', 'starts with one window|creates a box'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, PARAWERK_E2E_EXECUTABLE: executable },
});
process.exit(result.status ?? 1);
