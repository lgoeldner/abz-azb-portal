import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 30_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  // ponytail: PLAYWRIGHT_CHANNEL=chrome reuses the installed Google Chrome (preinstalled on GitHub runners), skipping the browser download.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: process.env.PLAYWRIGHT_CHANNEL || undefined } }],
});
