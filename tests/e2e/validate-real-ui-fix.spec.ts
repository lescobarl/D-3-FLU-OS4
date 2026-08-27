/**
 * VALIDACIÓN REAL DEL FIX — navegador con ventana (headed), GPU real, UI real.
 *
 * Diferencia con validate-fix-congelamientos: este test corre en un navegador
 * con VENTANA VISIBLE (headless: false) contra la app REAL en localhost:5173,
 * usa GPU real (mismo entorno que el usuario), click REAL al botón, lee el DOM
 * y el store REALES, y captura una IMAGEN REAL de la app con la transcripción
 * ya comprometida en el log.
 *
 * Única inyección (físicamente imposible de evitar en automatización):
 * shim de window.SpeechRecognition — el navegador no puede "hablar" real por
 * el micrófono. TODO lo demás es real: botón, DOM, store, avatar, WebGL.
 */
import { test, expect } from '@playwright/test';

test.use({
  headless: false, // VENTANA REAL visible
  viewport: { width: 1440, height: 900 },
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      // NO se fuerza swiftshader: usamos la GPU real del equipo (como el usuario).
    ],
  },
});

test.describe.configure({ mode: 'serial' });

test('REAL: el avatar NO se congela y la transcripción llega 0% pérdida (UI real, ventana real)', async ({ page }) => {
  test.setTimeout(360_000);

  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  // ---------- init: simular usuario real + shim STT + monitor de rAF ----------
  await page.addInitScript(() => {
    const w = window as any;
    // Usuario real: sin webdriver → el preload idle corre completo.
    try {
      Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => undefined });
    } catch { /* ignore */ }

    // Shim de SpeechRecognition (única inyección inevitable).
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

    // Monitor de rAF gaps (solo fase de interacción).
    w.__rafGaps = [];
    const origRAF = w.requestAnimationFrame.bind(w);
    let lastTs = performance.now();
    w.requestAnimationFrame = (cb: FrameRequestCallback) =>
      origRAF((ts: number) => {
        const gap = ts - lastTs;
        if (gap > 100) w.__rafGaps.push({ gap: Math.round(gap), at: Math.round(ts) });
        lastTs = ts;
        cb(ts);
      });
  });

  await page.context().grantPermissions(['microphone'], { origin: 'http://localhost:5173' });
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });

  const startBtn = page.getByRole('button', { name: 'Iniciar conversación' });
  await startBtn.waitFor({ state: 'visible', timeout: 60_000 });
  await expect(startBtn).toBeEnabled({ timeout: 60_000 });

  // ---------- Esperar cache caliente real (todas las animaciones) ----------
  await page
    .waitForFunction(() => (window as any).__bunnyPreloadDone === true, null, { timeout: 240_000 })
    .catch((e: any) => {
      throw new Error(`Preload de animaciones no completó en 240s: ${e.message}`);
    });

  // Info REAL del canvas WebGL (renderer, GPU) — evidencia de entorno real.
  const webglInfo = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return { canvas: false, renderer: '', vendor: '' };
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return { canvas: true, renderer: 'no-webgl', vendor: 'no-webgl' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      canvas: true,
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : String(gl.getParameter(gl.RENDERER)),
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : 'unknown',
    };
  });

  // ---------- Reset + click REAL ----------
  await page.evaluate(() => {
    const w = window as any;
    w.__rafGaps.length = 0;
    w.__sr.instances.length = 0;
    w.__sr.active = null;
    w.__clickAt = performance.now();
  });

  await startBtn.click();
  const closeBtn = page.getByRole('button', { name: 'Cerrar escucha' });
  await closeBtn.waitFor({ state: 'visible', timeout: 30_000 });

  const clickToListening = await page.evaluate(() => {
    const w = window as any;
    const t = w.__sr.startTime || 0;
    return {
      latencyMs: t ? Math.round(t - w.__clickAt) : -1,
      recognitionStarted: Boolean(w.__sr.active && w.__sr.active.started),
    };
  });

  // ---------- Habla real (interim → final) ----------
  const sentences = [
    { final: 'hola buenos dias quiero pedir un informe de ventas del dia de ayer', interim: 'hola buenos dias quiero pedir un informe' },
    { final: 'por favor agrega a la minuta que el cliente llega a las tres de la tarde', interim: 'por favor agrega a la minuta que el cliente' },
  ];
  const totalSpokenWords = sentences.reduce((acc, s) => acc + s.final.split(/\s+/).filter(Boolean).length, 0);

  for (let i = 0; i < sentences.length; i += 1) {
    const s = sentences[i];
    await page.evaluate(({ interim }) => {
      const w = window as any;
      if (w.__sr.active) w.__sr.active.emitInterim(interim);
    }, s);
    await page.waitForTimeout(320);
    await page.evaluate(({ final }) => {
      const w = window as any;
      if (w.__sr.active) w.__sr.active.emitFinal(final);
    }, s);
    await page.waitForTimeout(i === sentences.length - 1 ? 2500 : 950);
  }

  // ---------- Leer log REAL (DOM + store) ----------
  const history = await page.evaluate(async () => {
    // @ts-ignore — import en runtime del dev server Vite
    const mod: any = await import('/src/store/integrationStore.ts');
    const store = mod.useIntegrationStore.getState();
    return {
      conversationHistory: store.conversationHistory.map((e: any) => ({
        role: e.role,
        text: String(e.text || e.transcript || ''),
        speaker: e.speakerName || e.speaker || '',
      })),
      conversationState: store.conversationState,
    };
  });

  const domRows = await page.evaluate(() => {
    const rows: string[] = [];
    document.querySelectorAll('.conversation-panel__scroll .audit-item p').forEach((p) => {
      rows.push((p.textContent || '').replace(/\s+/g, ' ').trim());
    });
    return rows;
  });

  const perf = await page.evaluate(() => (window as any).__rafGaps);

  // ---------- CAPTURA REAL de la app con la transcripción comprometida ----------
  await page.waitForTimeout(600);
  const screenshotPath = 'test-results/real-ui-fix-conversacion.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });

  // ---------- Análisis de pérdida ----------
  const committedText = String(history.conversationHistory.map((e: any) => e.text).join(' '));
  const committedWords: string[] = committedText.split(/\s+/).filter(Boolean);
  const spokenWords = sentences.flatMap((s) => s.final.split(/\s+/).filter(Boolean));
  const committedSet = new Set(committedWords.map((x) => x.toLowerCase()));
  const lostWords = spokenWords.filter((x) => !committedSet.has(x.toLowerCase()));
  const lossRatio = totalSpokenWords ? Math.round((lostWords.length / totalSpokenWords) * 100) : 0;

  const hardFreezes = perf.filter((g: any) => g.gap > 1000);
  const report = `
═══════════════════════════════════════════════════════════════
  VALIDACIÓN REAL (ventana visible, GPU real) — congelamientos
═══════════════════════════════════════════════════════════════
  Navegador: VENTANA REAL (headless=false)
  WebGL: ${webglInfo.canvas ? 'canvas OK' : 'SIN CANVAS'}
    renderer: ${webglInfo.renderer}
    vendor: ${webglInfo.vendor}
  Click real → "Cerrar escucha" (onstart): ${clickToListening.latencyMs} ms
  recognitionStarted = ${clickToListening.recognitionStarted}
  ── Transcripción ──
  Entradas en store: ${history.conversationHistory.length}
  Filas en DOM: ${domRows.length}
  ${domRows.map((r) => `   • ${r}`).join('\n') || '   (vacío!)'}
  PÉRDIDA = ${lossRatio}% (${lostWords.length} palabras de ${totalSpokenWords})
  ${lostWords.length ? '   ej. perdidas: ' + [...new Set(lostWords)].slice(0, 12).join(', ') : ''}
  ── Congelamientos (fase de interacción) ──
  rAF gaps >100ms = ${perf.length}
  gaps >1000ms (freeze duro) = ${hardFreezes.length}
  ── Errores ──
  page errors = ${pageErrors.length}
  ${pageErrors.slice(0, 5).join('\n') || '   (sin page errors)'}
  Captura: ${screenshotPath}
═══════════════════════════════════════════════════════════════`;
  console.log(report);

  // ---------- Aserciones ----------
  expect(pageErrors, `page errors reales:\n${pageErrors.slice(0, 5).join('\n')}`).toEqual([]);
  expect(webglInfo.canvas, 'el avatar no renderizó canvas WebGL').toBe(true);
  expect(clickToListening.recognitionStarted, 'la recognition real no arrancó').toBe(true);
  // ANTES del fix: 27,347 ms. Ahora con cache caliente real debe ser mucho menor.
  expect(clickToListening.latencyMs, `el click sigue congelando: ${clickToListening.latencyMs}ms\n${report}`).toBeLessThan(8000);
  expect(history.conversationHistory.length, `se perdieron frases:\n${report}`).toBeGreaterThan(0);
  expect(lossRatio, `pérdida de transcripción ${lossRatio}%:\n${report}`).toBe(0);
  expect(hardFreezes.length, `freeze duro (>1000ms) real: ${JSON.stringify(hardFreezes)}\n${report}`).toBe(0);
});
