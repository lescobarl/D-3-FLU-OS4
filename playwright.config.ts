import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  fullyParallel: true,
  workers: 4,
  use: {
    // Mismo puerto que el dev server: si `npm run dev` ya está corriendo,
    // los E2E lo reutilizan (no relanzan Vite). Cada spec corre en su propio
    // contexto de navegador (IndexedDB/localStorage aislados del portal real).
    baseURL: 'http://localhost:5173',
    headless: true,
  },
  webServer: {
    command: 'npx vite --host',
    port: 5173,
    reuseExistingServer: true,
    env: {
      ...process.env,
      PLAYWRIGHT_SERVER: '1',
    },
  },
});
