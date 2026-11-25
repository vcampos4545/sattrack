import { defineConfig } from '@playwright/test';

/**
 * End-to-end smoke check: builds nothing, starts `vite preview` on the
 * production build and drives it in Chromium. Run `npm run build` first
 * (`npm run test:e2e` does both).
 *
 * Browser: Playwright's bundled Chromium by default
 * (`npx playwright install chromium`). Set PW_CHANNEL=chrome to use an
 * installed Google Chrome instead.
 *
 * Orbital data is real CelesTrak data, cached on disk by e2e/celestrak-cache.ts
 * so repeated runs respect CelesTrak's once-per-2-hours download policy.
 */
const PORT = 4179;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.results',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  // One worker: the tests share the on-disk CelesTrak cache.
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.PW_CHANNEL || undefined,
    viewport: { width: 1600, height: 1000 },
    timezoneId: 'America/Denver',
    launchOptions: {
      // Software WebGL so the 3D views render in headless mode.
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
