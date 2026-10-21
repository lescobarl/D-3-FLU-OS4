// Config de DEMO VIVA (no es parte de la suite regular): abre una ventana de
// Chrome VISIBLE sobre el portal real (mismo dev server) y alimenta su
// microfono con el DISPOSITIVO FALSO de Chrome leyendo la grabacion
// 45aeb8e2: cero stubs de getUserMedia/SpeechRecognition en la pagina.
//
//   npx playwright test -c playwright.live.config.ts
//
// El WAV del pad vive fuera del repo (os.tmpdir()/flu-replay).
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.PORT) || 5173;
const WAV = process.env.FLU_LIVE_WAV || '';

export default defineConfig({
  globalSetup: './tests/e2e/_globalSetup.ts',
  testDir: './tests/e2e',
  testMatch: /replay45aeb8e2-live\.spec\.ts/,
  timeout: 600000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: false,
    channel: 'chrome',
    permissions: ['microphone'],
    trace: 'off',
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${WAV}`,
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
