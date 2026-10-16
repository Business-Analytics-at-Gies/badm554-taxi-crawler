// Integration run against the real server (crew/server) and the real db (crew/db) working trees:
//   npx playwright test -c playwright.real.config.js
import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

const PORT = Number(process.env.PORT || 4177);
export default defineConfig({
  ...base,
  testMatch: /integration\.real\.js$/,
  use: { ...base.use, baseURL: `http://127.0.0.1:${PORT}` },
  webServer: { command: 'node real-server.cjs', port: PORT, reuseExistingServer: false, env: { PORT: String(PORT), SERVER_DIR: process.env.SERVER_DIR || '', DB_SITE: process.env.DB_SITE || '' } },
});
