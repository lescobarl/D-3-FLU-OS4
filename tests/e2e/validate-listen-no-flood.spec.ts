/**
 * VALIDACIÓN DEL FIX — EL PORTAL YA NO SE CAE EN ESCUCHA (Too Many Requests).
 *
 * Reproduce el escenario real reportado por el usuario: mientras el portal está
 * en escucha, la consola se inundaba con `checkNetwork @ healthMonitor.ts:499`
 * haciendo `HEAD https://www.jsdelivr.com/` → 429 (Too Many Requests) y
 * `net::ERR_ABORTED 429`, hasta reventar React con "Maximum update depth
 * exceeded" (caída del portal en escucha).
 *
 * Causa raíz (probada en el código): bucle de render. `useAutonomyIntegration`
 * devolvía un objeto `actions` NUEVO en cada render (sin useMemo), por lo que
 * el `useEffect` de App.tsx dependiente de `actions` se re-ejecutaba en CADA
 * render → startAllSystems() + updateSystemConfig() (setState + addNotification)
 * → re-render → bucle. Cada ciclo llamaba HealthMonitor.start(), que ejecuta
 * `await performHealthCheck()` ANTES de fijar `monitoringIntervalId` → arranques
 * concurrentes → verificación inicial duplicada → la inundación de checkNetwork.
 *
 * Este test:
 *   1. Suplanta navigator.webdriver=false → simula USUARIO REAL.
 *   2. Captura consola, page errors, requestfailed y TODAS las peticiones a los
 *      hosts de sonda de red desde el primer byte.
 *   3. Cuenta peticiones a jsdelivr (deben ser 0) y sondas HEAD a los hosts de
 *      sonda (google.com / one.one.one.one) — un número explosivo sería la
 *      firma del bucle de arranques concurrentes.
 *   4. Ejecuta N ciclos RÁPIDOS de escucha (iniciar → habla interim/final →
 *      cerrar → reiniciar) para estresar el camino de render exacto que antes
 *      tumbaba el portal.
 *   5. Afirma: 0 entradas de inundación (checkNetwork/429/jsdelivr/too many
 *      requests/Maximum update depth), 0 page errors, 0 peticiones a jsdelivr y
 *      un número ACOTADO de sondas HEAD.
 *
 * Única inyección: shim de window.SpeechRecognition (la STT del navegador no
 * puede hablar en automatización). El resto es UI/estado/DOM reales.
 */
import { test, expect } from '@playwright/test';

test.use({
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--no-sandbox',
    ],
  },
});

test.describe.configure({ mode: 'serial' });

// Firmas EXACTAS de la inundación reportada por el usuario. Incluye además la
// firma del diccionario de compresión (www.google.com → `Use-As-Dictionary` →
// fetch cross-origin del .dict → ruido CORS en consola) para que el host de
// sonda no pueda reintroducir ruido distinto al 429.
const FLOOD_CONSOLE_PATTERN = /checkNetwork|429|jsdelivr|too many requests|Maximum update depth|too much recursion|shared_dict|Use-As-Dictionary/i;
const PROBE_HOSTS = /(example\.com|one\.one\.one\.one)/i;
const JSDELIVR_HOSTS = /jsdelivr/i;

test('FIX: la escucha ya no inunda checkNetwork/429 ni revienta el render de React', async ({ page }) => {
  test.setTimeout(240_000);

  const floodLogs: string[] = [];
  const pageErrors: string[] = [];
  const jsdelivrRequests: string[] = [];
  const headProbes: string[] = [];

  page.on('console', (msg) => {
    const t = msg.text();
    if (FLOOD_CONSOLE_PATTERN.test(t)) floodLogs.push(`[${msg.type()}] ${t}`);
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (JSDELIVR_HOSTS.test(url)) {
      jsdelivrRequests.push(`[requestfailed] ${req.method()} ${url}`);
    }
  });
  page.on('request', (req) => {
    const url = req.url();
    if (JSDELIVR_HOSTS.test(url)) {
      jsdelivrRequests.push(`[request] ${req.method()} ${url}`);
    }
    if (req.method() === 'HEAD' && PROBE_HOSTS.test(url)) {
      headProbes.push(url);
    }
  });

  // ---------- init script: simular usuario real + shim STT ----------
  await page.addInitScript(() => {
    const w = window as any;
    // Simular USUARIO REAL: sin webdriver → los preloads del avatar corren.
    try {
      Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => undefined });
    } catch { /* ignore */ }

    // Shim de SpeechRecognition (igual que el diagnóstico real)
    w.__sr = { instances: [], active: null };
    class MockSR {
      lang = 'es';
      interimResults = true;
      continuous = true;
      maxAlternatives = 1;
      onstart: any = null;
      onresult: any = null;
      onerror: any = null;
      onend: any = null;
      started = false;
      private _idx = 0;
      constructor() { w.__sr.instances.push(this); }
      static install() { return Promise.resolve(true); }
      start() {
        this.started = true;
        w.__sr.active = this;
        w.__sr.startTime = performance.now();
        setTimeout(() => { if (this.onstart) this.onstart(); }, 0);
      }
      stop() {
        this.started = false;
        setTimeout(() => { if (this.onend) this.onend(); }, 0);
      }
      abort() { this.stop(); }
      emitFinal(text: string, interim = '') {
        const results: any[] = [];
        if (interim) results.push({ isFinal: false, 0: { transcript: interim }, length: 1 });
        results.push({ isFinal: true, 0: { transcript: text }, length: 1 });
        if (this.onresult) this.onresult({ resultIndex: 0, results });
      }
      emitInterim(text: string) {
        if (this.onresult) {
          this.onresult({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: text }, length: 1 }] });
        }
      }
    }
    w.SpeechRecognition = MockSR;
    w.webkitSpeechRecognition = MockSR;
  });

  await page.context().grantPermissions(['microphone'], { origin: 'http://localhost:5175' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const startBtn = page.getByRole('button', { name: 'Iniciar conversación' });
  await startBtn.waitFor({ state: 'visible', timeout: 60_000 });
  await expect(startBtn).toBeEnabled({ timeout: 60_000 });

  // ---------- N ciclos RÁPIDOS de escucha (estrés del camino de render) ----------
  const cycles = [
    { interim: 'hola buenos dias quiero un informe', final: 'hola buenos dias quiero pedir un informe de ventas del dia de ayer' },
    { interim: 'por favor agrega a la minuta', final: 'por favor agrega a la minuta que el cliente llega a las tres de la tarde' },
    { interim: 'y tambien recuerda el cumpleaños', final: 'y tambien recuerda el cumpleaños del equipo para la proxima semana' },
  ];

  const startedAt = Date.now();
  let listeningSessions = 0;
  for (let i = 0; i < cycles.length; i += 1) {
    const c = cycles[i];

    // Iniciar escucha (click REAL)
    await startBtn.click();
    const closeBtn = page.getByRole('button', { name: 'Cerrar escucha' });
    await closeBtn.waitFor({ state: 'visible', timeout: 30_000 });
    listeningSessions += 1;

    // Habla interim → final (fuerza re-renders de App mientras está en escucha)
    await page.evaluate(({ interim }) => {
      const w = window as any;
      if (w.__sr.active) w.__sr.active.emitInterim(interim);
    }, c);
    await page.waitForTimeout(250);
    await page.evaluate(({ final }) => {
      const w = window as any;
      if (w.__sr.active) w.__sr.active.emitFinal(final);
    }, c);
    await page.waitForTimeout(300);

    // Cerrar y reiniciar RÁPIDO (estrés del camino de render / arranques del monitor)
    await closeBtn.click();
    await startBtn.waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(150);
  }
  const elapsedMs = Date.now() - startedAt;

  // Dejar un margen para que cualquier bucle asíncrono residual se manifieste
  // (arranques concurrentes del HealthMonitor) antes de leer las métricas.
  await page.waitForTimeout(2000);

  const report = `
═══════════════════════════════════════════════════════════════
  VALIDACIÓN DEL FIX — portal estable en escucha (sin 429)
═══════════════════════════════════════════════════════════════
  Sesiones de escucha ejecutadas: ${listeningSessions}
  Duración de la prueba: ${elapsedMs} ms
  ── Sondas de red ──
  Peticiones a jsdelivr (host rate-limitado): ${jsdelivrRequests.length}
  ${jsdelivrRequests.slice(0, 10).join('\n') || '   (ninguna — el host problemático desapareció)'}
  Sondas HEAD a hosts de sonda (google.com / one.one.one.one): ${headProbes.length}
  ${headProbes.slice(0, 10).join('\n') || '   (ninguna)'}
  ── Inundación (consola) ──
  Entradas checkNetwork/429/jsdelivr/ERR_ABORTED/Maximum update depth: ${floodLogs.length}
  ${floodLogs.slice(0, 10).join('\n') || '   (sin inundación)'}
  ── Errores ──
  page errors = ${pageErrors.length}
  ${pageErrors.slice(0, 5).join('\n') || '   (sin page errors)'}
═══════════════════════════════════════════════════════════════`;
  console.log(report);

  // ---------- Aserciones del FIX ----------
  expect(pageErrors, `page errors durante la escucha:\n${pageErrors.slice(0, 5).join('\n')}\n${report}`).toEqual([]);
  expect(
    floodLogs,
    `inundación detectada durante la escucha (antes: checkNetwork/429/Maximum update depth):\n${floodLogs.slice(0, 20).join('\n')}\n${report}`,
  ).toEqual([]);
  // El host rate-limitado (jsdelivr) no debe recibir NINGUNA petición.
  expect(
    jsdelivrRequests,
    `siguen existiendo peticiones a jsdelivr (host 429):\n${jsdelivrRequests.slice(0, 10).join('\n')}\n${report}`,
  ).toEqual([]);
  // Sonda HEAD ACOTADA: con el fix el HealthMonitor arranca UNA vez (verificación
  // inicial) + las del intervalo. Un número explosivo (>30 en segundos) sería la
  // firma del bucle de arranques concurrentes que producía la inundación.
  expect(
    headProbes.length,
    `demasiadas sondas HEAD (${headProbes.length}) en ${elapsedMs}ms — firma del bucle de arranques:\n${headProbes.slice(0, 30).join('\n')}\n${report}`,
  ).toBeLessThan(30);
});
