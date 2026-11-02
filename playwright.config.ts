import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173/foulee/',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm --filter @foulee/app preview --port 4173 --strictPort',
    url: 'http://localhost:4173/foulee/',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'ipad', use: { ...devices['iPad Pro 11'], browserName: 'chromium' } },
  ],
});
