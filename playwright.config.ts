import { defineConfig } from '@playwright/test';

// Puerto del dev server: default único para E2E (override con PORT).
const PORT = Number(process.env.PORT) || 5173;
const BASE_URL = `http://localhost:${PORT}`;

// CI (runner de 4 vCPU) no aguanta 4 chromium + Vite: la saturacion mataba
// workers y sus tests salian como "did not run". MEDIDO en local (P7.25): el
// mismo techo existe aqui, y es mas bajo de lo que parecia -- con 4 workers
// specs que pasan AISLADOS fallaban por carga (.flu-shell no aparecia en 15 s;
// paginas cerradas a mitad de test) y los timeouts duros mataban al worker,
// arrastrando "did not run". Con 2 seguia habiendo flakiness real (el flujo de
// onboarding, que tarda ~40 s, agotaba su timeout de 60 s en la corrida
// paralela y pasa aislado). Con 1 es determinista. Local = CI = 1 hasta que
// haya evidencia de que el runner aguanta mas.
const CI = process.env.CI === '1' || process.env.CI === 'true';
const WORKERS = 1;

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
