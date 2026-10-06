import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '.env.local'), quiet: true });

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: [['list']],
  outputDir: '../../test-results',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    browserName: 'firefox',
    ...devices['Desktop Firefox'],
    screenshot: 'off',
    trace: 'off',
    video: 'off',
    navigationTimeout: 90_000,
  },
  projects: [{ name: 'firefox', use: { browserName: 'firefox' } }],
  webServer: undefined,
});
