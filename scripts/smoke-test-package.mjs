// Runs `--self-test` on the packaged (unpacked) app of the current platform; exits non-zero on failure.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
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

const output = path.join(mkdtempSync(path.join(tmpdir(), 'parawerk-smoke-')), 'result.json');
console.log(`Running ${executable} --self-test`);
const child = spawn(executable, ['--self-test'], { env: { ...process.env, PARAWERK_SELF_TEST_OUTPUT: output }, stdio: 'inherit' });
const killer = setTimeout(() => {
  console.error('Self-test did not finish within 4 minutes.');
  child.kill();
}, 240_000);

child.on('exit', (code) => {
  clearTimeout(killer);
  if (existsSync(output)) {
    const result = JSON.parse(readFileSync(output, 'utf8'));
    for (const check of result.checks) console.log(`${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`);
    console.log(`Self-test ${result.ok ? 'passed' : 'failed'} in ${result.durationMs} ms`);
  } else {
    console.error('The app did not write a self-test result.');
  }
  process.exit(code === 0 && existsSync(output) ? 0 : 1);
});
