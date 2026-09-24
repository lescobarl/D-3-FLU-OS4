import { defineConfig } from '@playwright/test';
import { availableParallelism } from 'node:os';

// Puerto del dev server: default único para E2E (override con PORT).
const PORT = Number(process.env.PORT) || 5173;
const BASE_URL = `http://localhost:${PORT}`;

// CI (runner de 4 vCPU) no aguanta 4 chromium + Vite: la saturacion mataba
// workers y sus tests salian como "did not run". Local se deriva del hardware
// real (misma leccion que C74 en vitest): 12 cpus -> 4, identico a antes.
const CI = process.env.CI === '1' || process.env.CI === 'true';
const WORKERS = CI ? 2 : Math.max(1, Math.min(4, availableParallelism() - 1));

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  fullyParallel: true,
  workers: WORKERS,
  retries: CI ? 1 : 0,
  use: {
    // Mismo puerto que el dev server: si `npm run dev` ya está corriendo,
    // los E2E lo reutilizan (no relanzan Vite). Cada spec corre en su propio
    // contexto de navegador (IndexedDB/localStorage aislados del portal real).
    baseURL: BASE_URL,
    headless: true,
    // Traza solo al fallar: sin ella el reintento esconde el crash en vez de explicarlo.
    trace: 'retain-on-failure',
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
