import { defineConfig } from '@playwright/test';

export default defineConfig({
  timeout: 120_000,
  expect: { timeout: 20_000 },
  // Each test starts its own Electron instance with a GPU context; run them one at a time.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'e2e', testDir: 'tests/e2e' },
    { name: 'docs', testDir: 'tests/docs' },
    { name: 'bench', testDir: 'bench/render', testMatch: '**/*.bench.ts', timeout: 900_000 },
  ],
});
