import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.PORT || 4183);
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.js$/,
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.BASE_URL || `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  webServer: process.env.BASE_URL ? undefined : {
    command: 'node server.js', port: PORT, reuseExistingServer: false, env: { PORT: String(PORT), DB_SITE: process.env.DB_SITE || '' },
  },
  projects: [
    { name: 'desktop-1280', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
    { name: 'mobile-375', use: { browserName: 'chromium', viewport: { width: 375, height: 740 }, isMobile: false, hasTouch: false } },
  ],
});
