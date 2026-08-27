/**
 * DIAGNÓSTICO REAL (no inyección de store): transcripción perdida + congelamientos.
 *
 * - Navega al servidor DEV REAL en http://localhost:5173 (el que el usuario tiene
 *   levantado en la terminal) para que los relayLog/fluDebugHot aparezcan ahí.
 * - Usa micrófono simulado real (fake media stream) para que getUserMedia/AudioContext
 *   y la captura de audio funcionen de verdad.
 * - ÚNICA inyección: shim de window.SpeechRecognition (la API de STT del navegador no
 *   puede hablar de verdad en automatización). Todo lo demás es UI/estado/DOM reales:
 *   click real al botón, chip real, log real, store real.
 * - Mide: latencia click→escuchando, latencia habla→commit, rAF gaps (congelamientos),
 *   long tasks, errores de página, y cuánta transcripción se pierde en el log real.
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

test('DIAGNÓSTICO: transcripción y congelamientos con UI real', async ({ page }) => {
  test.setTimeout(180_000);

  // ---------- Captura de logs ----------
  const consoleLogs: string[] = [];
  const pageErrors: string[] = [];
  const relayPayloads: string[] = [];
  let relayPostCount = 0;

  page.on('console', (msg) => {
    const t = msg.type();
    const text = msg.text();
    if (t === 'error' || t === 'warning' || /\[DIAG\]|\[Flu\]|relay|ingress|fluTrace/i.test(text)) {
      consoleLogs.push(`[${t}] ${text}`);
    }
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('request', (req) => {
    if (req.url().includes('/__flu_client_log')) {
      relayPostCount += 1;
      try {
        const body = req.postData() || '';
        if (body) relayPayloads.push(body);
      } catch {
        /* ignore */
      }
    }
  });

  // ---------- Shim de SpeechRecognition + monitores de rendimiento (corre ANTES del app JS) ----------
  await page.addInitScript(() => {
    const w = window as any;
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
      constructor() {
        w.__sr.instances.push(this);
      }
      static install() {
        return Promise.resolve(true);
      }
      start() {
        this.started = true;
        w.__sr.active = this;
        w.__sr.startTime = performance.now();
        setTimeout(() => {
          if (this.onstart) this.onstart();
        }, 0);
      }
      stop() {
        this.started = false;
        setTimeout(() => {
          if (this.onend) this.onend();
        }, 0);
      }
      abort() {
        this.stop();
      }
      emitFinal(text: string, interim = '') {
        const results: any[] = [];
        if (interim) {
          results.push({ isFinal: false, 0: { transcript: interim }, length: 1 });
        }
        results.push({ isFinal: true, 0: { transcript: text }, length: 1 });
        if (this.onresult) {
          this.onresult({ resultIndex: 0, results });
        }
      }
      emitInterim(text: string) {
        if (this.onresult) {
          this.onresult({
            resultIndex: 0,
            results: [{ isFinal: false, 0: { transcript: text }, length: 1 }],
          });
        }
      }
    }

    w.SpeechRecognition = MockSR;
    w.webkitSpeechRecognition = MockSR;

    // Monitor de rAF gaps (congelamientos > 100ms)
    w.__rafGaps = [];
    const origRAF = w.requestAnimationFrame.bind(w);
    let lastTs = performance.now();
    w.requestAnimationFrame = (cb: FrameRequestCallback) =>
      origRAF((ts: number) => {
        const gap = ts - lastTs;
        if (gap > 100) {
          w.__rafGaps.push({ gap: Math.round(gap), at: Math.round(ts) });
        }
        lastTs = ts;
        cb(ts);
      });

    // Long tasks del hilo principal
    w.__longTasks = [];
    if (typeof PerformanceObserver === 'function') {
      try {
        const obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            w.__longTasks.push({ dur: Math.round((e as any).duration), at: Math.round(e.startTime) });
          }
        });
        obs.observe({ entryTypes: ['longtask'] });
      } catch {
        /* ignore */
      }
    }
  });

  await page.context().grantPermissions(['microphone'], { origin: 'http://localhost:5175' });

  // ---------- Navegar al app REAL ----------
  const navStart = Date.now();
  await page.goto('http://localhost:5175/', { waitUntil: 'domcontentloaded' });

  // El botón real "Iniciar conversación" debe estar visible y habilitado (isSupported=true)
  const startBtn = page.getByRole('button', { name: 'Iniciar conversación' });
  await startBtn.waitFor({ state: 'visible', timeout: 60_000 });
  await expect(startBtn).toBeEnabled({ timeout: 60_000 });

  // ---------- Reset de métricas + click REAL ----------
  await page.evaluate(() => {
    const w = window as any;
    w.__rafGaps.length = 0;
    w.__longTasks.length = 0;
    w.__sr.instances.length = 0;
    w.__sr.active = null;
    w.__clickAt = performance.now();
    w.__recognitionStartedAt = 0;
  });

  await startBtn.click();

  // El estado REAL de la UI debe pasar a "Cerrar escucha" => recognition.onstart disparó.
  // CONFIRMADO por probe (tests/e2e/probe-close-listening.mjs): el botón es totalmente visible
  // (isVisible=true, box 126x32) pero aparece ~17.7s después del click porque handleStartConversation
  // espera la locución "Iniciando conversacion." (TTS) ANTES de iniciar la escucha. Bajo carga
  // (suite en paralelo) esa locución puede superar 30s. El timeout debe dar margen holgado.
  const closeBtn = page.getByRole('button', { name: 'Cerrar escucha' });
  await closeBtn.waitFor({ state: 'visible', timeout: 90_000 });

  const clickToListening = await page.evaluate(() => {
    const w = window as any;
    const t = w.__sr.startTime || 0;
    return {
      latencyMs: t ? Math.round(t - w.__clickAt) : -1,
      recognitionStarted: Boolean(w.__sr.active && w.__sr.active.started),
      instanceCount: w.__sr.instances.length,
    };
  });

  // ---------- Alimentar habla REAL (interim → final) con pausas de persona ----------
  const sentences = [
    { final: 'hola buenos dias quiero pedir un informe de ventas del dia de ayer', interim: 'hola buenos dias quiero pedir un informe' },
    { final: 'tambien necesito que revises la agenda de esta tarde', interim: 'tambien necesito que revises la agenda' },
    { final: 'por favor agrega a la minuta que el cliente llega a las tres de la tarde', interim: 'por favor agrega a la minuta que el cliente' },
    { final: 'muchas gracias eso seria todo por ahora', interim: 'muchas gracias eso seria' },
  ];

  const totalSpokenWords = sentences.reduce((acc, s) => acc + s.final.split(/\s+/).filter(Boolean).length, 0);

  const emitStart = Date.now();
  for (let i = 0; i < sentences.length; i += 1) {
    const s = sentences[i];
    await page.evaluate(
      ({ final, interim }) => {
        const w = window as any;
        if (!w.__sr.active) return;
        w.__sr.active.emitInterim(interim);
      },
      s,
    );
    await page.waitForTimeout(320);
    await page.evaluate(
      ({ final }) => {
        const w = window as any;
        if (!w.__sr.active) return;
        w.__sr.active.emitFinal(final);
      },
      s,
    );
    // pausa entre frases (9 palabras ~ 900ms)
    await page.waitForTimeout(i === sentences.length - 1 ? 2500 : 950);
  }

  // ---------- Leer el log REAL (DOM + store real) ----------
  // Esperar a que al menos aparezca texto en la bitácora
  const logPanel = page.locator('.conversation-panel__scroll .audit-list');
  await expect(logPanel).toBeVisible({ timeout: 15_000 }).catch(() => {});

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
      lastResponse: store.lastResponse || '',
    };
  });

  const domRows = await page.evaluate(() => {
    const rows: string[] = [];
    document.querySelectorAll('.conversation-panel__scroll .audit-item p').forEach((p) => {
      rows.push((p.textContent || '').replace(/\s+/g, ' ').trim());
    });
    return rows;
  });

  const livePhrase = await page.evaluate(() => {
    const w = window as any;
    return w.__sr.active ? 'active' : 'none';
  });

  // ---------- Métricas de congelamiento ----------
  const perf = await page.evaluate(() => {
    const w = window as any;
    return {
      rafGaps: w.__rafGaps,
      longTasks: w.__longTasks,
      relayStatus: w.__fluClientLog ? w.__fluClientLog.status() : null,
    };
  });

  const emitEnd = Date.now();
  const emitDurationMs = emitEnd - emitStart;

  // ---------- Análisis de pérdida ----------
  const committedText = String(history.conversationHistory.map((e: any) => e.text).join(' '));
  const committedWords: string[] = committedText.split(/\s+/).filter(Boolean);
  const spokenWords = sentences.flatMap((s) => s.final.split(/\s+/).filter(Boolean));
  const committedSet = new Set(committedWords.map((x) => x.toLowerCase()));
  const lostWords = spokenWords.filter((x) => !committedSet.has(x.toLowerCase()));
  const lossRatio = totalSpokenWords ? Math.round((lostWords.length / totalSpokenWords) * 100) : 0;

  const domText = domRows.join(' ');

  const report = `
═══════════════════════════════════════════════════════════════
  DIAGNÓSTICO REAL — transcripción y congelamientos
═══════════════════════════════════════════════════════════════
  Navegación: ${navStart} → app cargada
  Botón real click → status "Cerrar escucha" (onstart):
     latencia = ${clickToListening.latencyMs} ms
     recognitionStarted = ${clickToListening.recognitionStarted}
     instancias creadas = ${clickToListening.instanceCount}
  Emisión de habla: ${sentences.length} frases, ${totalSpokenWords} palabras, ${emitDurationMs} ms
  Estado real del store: conversationState = ${history.conversationState}
  ── Transcripción (log real DOM) ──
  Filas en DOM: ${domRows.length}
  ${domRows.map((r) => `   • ${r}`).join('\n') || '   (vacío — NADA commitado!)'}
  ── Store real (conversationHistory) ──
  Entradas: ${history.conversationHistory.length}
  ${history.conversationHistory.map((e: any) => `   [${e.role}${e.speaker ? '/' + e.speaker : ''}] ${e.text}`).join('\n') || '   (vacío)'}
  ── PÉRDIDA DE TRANSCRIPCIÓN ──
  palabras habladas = ${totalSpokenWords}
  palabras únicas commitadas = ${committedSet.size}
  palabras perdidas = ${lostWords.length}  →  ratio pérdida = ${lossRatio}%
  ${lostWords.length ? '   ej. perdidas: ' + [...new Set(lostWords)].slice(0, 12).join(', ') : ''}
  ── CONGELAMIENTOS ──
  rAF gaps >100ms = ${perf.rafGaps.length}
  ${perf.rafGaps.slice(0, 8).map((g: any) => `   gap=${g.gap}ms @${g.at}`).join('\n') || '   (sin gaps)'}
  long tasks = ${perf.longTasks.length}
  ${perf.longTasks.slice(0, 8).map((l: any) => `   ${l.dur}ms @${l.at}`).join('\n') || '   (sin long tasks)'}
  relayLog status = ${JSON.stringify(perf.relayStatus)}
  POSTs a /__flu_client_log = ${relayPostCount}
  ── Errores ──
  page errors = ${pageErrors.length}
  ${pageErrors.slice(0, 5).join('\n') || '   (sin page errors)'}
  console errors/warn = ${consoleLogs.length}
  ${consoleLogs.slice(0, 20).join('\n') || '   (sin logs relevantes)'}
═══════════════════════════════════════════════════════════════`;

  console.log(report);

  // ---------- Aserciones (informativas; el veredicto sale de la observación) ----------
  expect(pageErrors, `page errors detectados:\n${pageErrors.slice(0, 5).join('\n')}`).toEqual([]);
  expect(clickToListening.recognitionStarted, 'la recognition real no arrancó').toBe(true);
  expect(
    history.conversationHistory.length,
    `se perdieron frases: habladas=${sentences.length}, commitadas=${history.conversationHistory.length}\n${report}`,
  ).toBeGreaterThan(0);
  expect(
    lossRatio,
    `pérdida de transcripción demasiado alta (${lossRatio}%):\n${report}`,
  ).toBeLessThan(60);
});
