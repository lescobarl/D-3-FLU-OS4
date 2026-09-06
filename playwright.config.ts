import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  fullyParallel: true,
  workers: 4,
  use: {
    baseURL: 'http://localhost:5175',
    headless: true,
  },
  webServer: {
    command: 'npx vite --port 5175 --host',
    port: 5175,
    reuseExistingServer: true,
    env: {
      ...process.env,
      PLAYWRIGHT_SERVER: '1',
    },
  },
});
