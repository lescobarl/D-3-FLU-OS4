// Config de REPLAY (no es parte de la suite regular): corre solo el spec que
// inyecta la grabacion 45aeb8e2 como MICROFONO de la app (stub de getUserMedia
// del spec, vía Web Audio). El WAV del pad vive fuera del repo
// (os.tmpdir()/flu-replay): es un artefacto de sesion, no basura del proyecto.
//
//   npx playwright test -c playwright.replay.config.ts
//   FLU_REPLAY_SR=mute npx playwright test -c playwright.replay.config.ts
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.PORT) || 5173;

export default defineConfig({
  globalSetup: './tests/e2e/_globalSetup.ts',
  testDir: './tests/e2e',
  testMatch: /replay45aeb8e2-audio\.spec\.ts/,
  timeout: 600000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    // El audio entra por el stub de getUserMedia del spec (Web Audio), no por
    // el dispositivo del SO: corre headless sin depender de Chromium.
    headless: true,
    trace: 'retain-on-failure',
    permissions: ['microphone'],
    launchOptions: {
      args: [
        // La app abre AudioContext/escucha sin gesto de usuario (headless).
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  webServer: {
    command: 'npx vite --host',
    port: PORT,
    reuseExistingServer: true,
    env: { ...process.env, PLAYWRIGHT_SERVER: '1' },
  },
});
