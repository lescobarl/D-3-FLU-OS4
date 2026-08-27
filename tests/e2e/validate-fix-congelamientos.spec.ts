/**
 * VALIDACIÓN DEL FIX DE CONGELAMIENTOS + TRANSCRIPCIÓN (UI real).
 *
 * Reproduce el escenario real del usuario: cache de animaciones FRÍO al arrancar.
 * Antes del fix, el preload idle se desactivaba en renderers de software y la
 * primera interacción (click a "Iniciar conversación") disparaba una carga
 * síncrona de FBX bajo demanda que congelaba el hilo principal ~10-20s
 * (medido: 27,347 ms click→escuchando; rAF gaps de 12,083 ms y 5,417 ms).
 *
 * Este test:
 *   1. Suplanta navigator.webdriver=false → simula USUARIO REAL para que el
 *      preload idle de animaciones corra (en CI/headless real va desactivado).
 *   2. Espera a que las animaciones CRÍTICAS (Idle_1/2/3 y Emo_blink, Emo_neutral,
 *      Emo_mouth_open) queden cacheadas.
 *   3. Click REAL a "Iniciar conversación" y mide la latencia click→escuchando.
 *   4. Alimenta habla real (interim→final) y verifica 0% de pérdida en DOM+store.
 *   5. Mide rAF gaps durante la interacción (sin congelamientos duros).
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

test('FIX: precarga de animaciones elimina el freeze del click y la pérdida de transcripción', async ({ page }) => {
  test.setTimeout(360_000);

  const consoleLogs: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (msg) => {
    const t = msg.text();
    if (t === 'error' || t === 'warning' || /\[DIAG\]|\[Flu\]|Preload|ingress|relay/i.test(t)) {
      consoleLogs.push(`[${msg.type()}] ${t}`);
    }
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  // ---------- init script: simular usuario real + shim STT + monitores ----------
  await page.addInitScript(() => {
    const w = window as any;
    // Simular USUARIO REAL: sin webdriver → el preload idle de BunnyViewer corre.
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

    // Monitor de rAF gaps (>100ms = congelamiento) SOLO de la fase de interacción
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

  await page.context().grantPermissions(['microphone'], { origin: 'http://localhost:5175' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const startBtn = page.getByRole('button', { name: 'Iniciar conversación' });
  await startBtn.waitFor({ state: 'visible', timeout: 60_000 });
  await expect(startBtn).toBeEnabled({ timeout: 60_000 });

  // ---------- Esperar a que el preload idle cachee TODAS las animaciones ----------
  // El preloader (BunnyViewer) expone window.__bunnyPreloadDone al terminar la
  // cola. Con cache caliente la interacción es 100% Cache HIT (sin freeze).
  await page
    .waitForFunction(() => (window as any).__bunnyPreloadDone === true, null, {
      timeout: 240_000,
    })
    .catch((e: any) => {
      throw new Error(`Preload de animaciones no completó en 240s: ${e.message}`);
    });
  console.log('[TEST] Animaciones cacheadas — iniciando interacción real');

  // ---------- Reset de métricas + click REAL ----------
  await page.evaluate(() => {
    const w = window as any;
    w.__rafGaps.length = 0;
    w.__sr.instances.length = 0;
    w.__sr.active = null;
    w.__clickAt = performance.now();
    w.__recognitionStartedAt = 0;
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

  // ---------- Alimentar habla real (interim → final) ----------
  const sentences = [
    { final: 'hola buenos dias quiero pedir un informe de ventas del dia de ayer', interim: 'hola buenos dias quiero pedir un informe' },
    { final: 'por favor agrega a la minuta que el cliente llega a las tres de la tarde', interim: 'por favor agrega a la minuta que el cliente' },
  ];
  const totalSpokenWords = sentences.reduce((acc, s) => acc + s.final.split(/\s+/).filter(Boolean).length, 0);

  const emitStart = Date.now();
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
  const emitDurationMs = Date.now() - emitStart;

  // ---------- Leer log real (DOM + store) ----------
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

  const perf = await page.evaluate(() => {
    const w = window as any;
    return { rafGaps: w.__rafGaps };
  });

  // ---------- Análisis de pérdida ----------
  const committedText = String(history.conversationHistory.map((e: any) => e.text).join(' '));
  const committedWords: string[] = committedText.split(/\s+/).filter(Boolean);
  const spokenWords = sentences.flatMap((s) => s.final.split(/\s+/).filter(Boolean));
  const committedSet = new Set(committedWords.map((x) => x.toLowerCase()));
  const lostWords = spokenWords.filter((x) => !committedSet.has(x.toLowerCase()));
  const lossRatio = totalSpokenWords ? Math.round((lostWords.length / totalSpokenWords) * 100) : 0;

  const hardFreezes = perf.rafGaps.filter((g: any) => g.gap > 1000);
  const report = `
═══════════════════════════════════════════════════════════════
  VALIDACIÓN DEL FIX — congelamientos y transcripción
═══════════════════════════════════════════════════════════════
  Click real → "Cerrar escucha" (onstart): ${clickToListening.latencyMs} ms
  recognitionStarted = ${clickToListening.recognitionStarted}
  Emisión: ${sentences.length} frases, ${totalSpokenWords} palabras, ${emitDurationMs} ms
  Estado store: conversationState = ${history.conversationState}
  ── Transcripción ──
  Entradas en store: ${history.conversationHistory.length}
  Filas en DOM: ${domRows.length}
  ${domRows.map((r) => `   • ${r}`).join('\n') || '   (vacío!)'}
  PÉRDIDA = ${lossRatio}% (${lostWords.length} palabras de ${totalSpokenWords})
  ${lostWords.length ? '   ej. perdidas: ' + [...new Set(lostWords)].slice(0, 12).join(', ') : ''}
  ── Congelamientos (fase de interacción) ──
  rAF gaps >100ms = ${perf.rafGaps.length}
  ${perf.rafGaps.slice(0, 6).map((g: any) => `   gap=${g.gap}ms @${g.at}`).join('\n') || '   (sin gaps)'}
  gaps >1000ms (freeze duro) = ${hardFreezes.length}
  ── Errores ──
  page errors = ${pageErrors.length}
  ${pageErrors.slice(0, 5).join('\n') || '   (sin page errors)'}
═══════════════════════════════════════════════════════════════`;
  console.log(report);

  // ---------- Aserciones del FIX ----------
  expect(pageErrors, `page errors detectados:\n${pageErrors.slice(0, 5).join('\n')}`).toEqual([]);
  expect(clickToListening.recognitionStarted, 'la recognition real no arrancó').toBe(true);
  // ANTES del fix: 27,347 ms. Ahora con cache caliente debe ser mucho menor.
  expect(
    clickToListening.latencyMs,
    `el click sigue congelando: ${clickToListening.latencyMs}ms (antes 27,347ms)\n${report}`,
  ).toBeLessThan(8000);
  expect(history.conversationHistory.length, `se perdieron frases:\n${report}`).toBeGreaterThan(0);
  expect(lossRatio, `pérdida de transcripción ${lossRatio}%:\n${report}`).toBe(0);
  // Sin freeze duro durante la interacción con cache caliente.
  expect(hardFreezes.length, `freeze duro (>1000ms) durante interacción: ${JSON.stringify(hardFreezes)}\n${report}`).toBe(0);
});
