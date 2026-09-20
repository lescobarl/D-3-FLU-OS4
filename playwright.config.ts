import { defineConfig } from '@playwright/test';

// Puerto del dev server: default único para E2E (override con PORT).
const PORT = Number(process.env.PORT) || 5173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  fullyParallel: true,
  workers: 4,
  use: {
    // Mismo puerto que el dev server: si `npm run dev` ya está corriendo,
    // los E2E lo reutilizan (no relanzan Vite). Cada spec corre en su propio
    // contexto de navegador (IndexedDB/localStorage aislados del portal real).
    baseURL: BASE_URL,
    headless: true,
  },
  webServer: {
    command: 'npx vite --host',
    port: PORT,
    reuseExistingServer: true,
    env: {
      ...process.env,
      PLAYWRIGHT_SERVER: '1',
    },
  },
});
