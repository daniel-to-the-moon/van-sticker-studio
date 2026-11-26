// Key-path e2e for the built app served by `wrangler dev` (see .github/workflows/e2e.yml).
// @playwright/test is installed by the workflow with --no-save so package-lock.json is untouched.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.mjs$/,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: process.env.E2E_REPORT ?? 'e2e-report.json' }]],
  outputDir: process.env.E2E_OUTPUT ?? 'e2e-output',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8787',
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    launchOptions: {
      // Software WebGL on CI runners without a GPU.
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
});
