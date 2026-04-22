import { test, expect, request as pwRequest } from '@playwright/test';

/**
 * Smoke tests — exercise the critical end-to-end paths so we catch
 * "nothing renders" / "login is broken" regressions before shipping. These
 * are NOT a replacement for unit/integration tests; they're the last line
 * before a user opens the app.
 *
 * Assumes:
 *   - Server is running on BASE_URL with the demo user seeded
 *     (email=trader@claude.ai, password=trading123 — see server/seed.js).
 *   - The prod build of the client is served by Express at BASE_URL, OR
 *     the Vite dev server proxies /api to the backend.
 */

const DEMO_EMAIL    = process.env.E2E_EMAIL    || 'trader@claude.ai';
const DEMO_PASSWORD = process.env.E2E_PASSWORD || 'trading123';

test.describe('smoke', () => {
  test('health endpoint returns ok without auth', async ({ baseURL }) => {
    const ctx = await pwRequest.newContext({ baseURL });
    const res = await ctx.get('/api/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  test('metrics endpoint is Prometheus-formatted', async ({ baseURL }) => {
    const ctx = await pwRequest.newContext({ baseURL });
    const res = await ctx.get('/api/metrics');
    expect(res.ok()).toBeTruthy();
    const text = await res.text();
    // Must contain at least one TYPE declaration and the process uptime gauge.
    expect(text).toMatch(/# TYPE /);
    expect(text).toContain('process_uptime_seconds');
  });

  test('login page renders', async ({ page }) => {
    await page.goto('/login');
    // Two heuristics in case the copy changes — either the heading or a
    // visible password input is enough to confirm the page mounted.
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('login + dashboard loads + core widgets appear', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', DEMO_EMAIL);
    await page.fill('input[type="password"]', DEMO_PASSWORD);
    await page.getByRole('button', { name: /Sign In/i }).click();
    // Redirect lands us at /. Wait for the Dashboard heading before asserting
    // widgets render — the widgets depend on API calls that can be slow in CI.
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Portfolio Value')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Auto-Trader/ })).toBeVisible();
  });

  test('account settings page is reachable after login', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', DEMO_EMAIL);
    await page.fill('input[type="password"]', DEMO_PASSWORD);
    await page.getByRole('button', { name: /Sign In/i }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'Account Settings' })).toBeVisible();
    // 2FA section should be present — whether it shows enable or disable copy
    // depends on the user's state, so match either.
    await expect(page.getByRole('heading', { name: /Two-factor authentication/i })).toBeVisible();
  });

  test('unauthenticated access to / redirects to login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });
});
