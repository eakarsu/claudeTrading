import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright smoke config.
 *
 * Assumes both the server (port 3001) and client (port 5173 dev, or 3001 prod
 * build served by Express) are running externally — we don't try to spawn
 * them from Playwright. In CI, start them before invoking `npm test` from
 * this directory.
 *
 * Override the target URL with BASE_URL in the environment; defaults to the
 * single-process prod layout where Express serves both API and SPA on 3001.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,          // a handful of tests — no need for shards
  forbidOnly: !!process.env.CI,  // fail CI if .only leaked into a commit
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3001',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
